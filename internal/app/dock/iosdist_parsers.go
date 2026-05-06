package dock

// Parsers for the two artifact types users upload to the resource center.
//
//   - .mobileprovision: a CMS-signed plist. We bypass the CMS layer entirely
//     and extract the embedded XML plist by scanning bytes for the
//     "<?xml ... </plist>" envelope. This works because Apple's tooling
//     always emits a plain-text XML plist inside the SignedData, and dozens
//     of community tools (fastlane, ios-deploy, etc.) rely on the same
//     fact. If Apple ever switches to a binary plist payload we'll need a
//     real CMS unwrap, but that hasn't happened in 10+ years.
//
//   - .p12: PKCS#12 with an optional passphrase. We pull the leaf
//     certificate out via golang.org/x/crypto/pkcs12 (frozen but stable)
//     and surface CommonName, NotAfter, and a heuristic Team ID from the
//     Subject's Organizational Unit values (Apple uses a 10-char
//     alphanumeric OU as the Team ID).

import (
	"bytes"
	"crypto/x509"
	"encoding/xml"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/pkcs12"
)

// ---- mobileprovision ------------------------------------------------------

type provisionInfo struct {
	Name                 string
	AppIDName            string
	ApplicationID        string // application-identifier, e.g. "ABCDE12345.com.foo.bar"
	TeamID               string
	TeamName             string
	ExpirationDate       *time.Time
	CreationDate         *time.Time
	ProvisionedDevices   []string
	ProvisionsAllDevices bool
	GetTaskAllow         bool
	Kind                 string // app_store|ad_hoc|enterprise|development
}

// extractProvisionPlist locates the inner XML plist within a CMS-wrapped
// .mobileprovision blob. Returns the slice including the <?xml ... ?>
// declaration through the closing </plist>.
func extractProvisionPlist(raw []byte) ([]byte, error) {
	start := bytes.Index(raw, []byte("<?xml"))
	if start < 0 {
		return nil, errors.New("xml prologue not found")
	}
	end := bytes.LastIndex(raw, []byte("</plist>"))
	if end < 0 || end <= start {
		return nil, errors.New("plist terminator not found")
	}
	return raw[start : end+len("</plist>")], nil
}

// parseMobileProvision pulls the metadata fields out of the embedded
// plist. The XML decoder is sloppy on purpose — the plist format alternates
// <key> / <value> pairs at one level, which is awkward to model in
// encoding/xml structurally; instead we walk the token stream and pull
// the values we recognise.
func parseMobileProvision(raw []byte) (*provisionInfo, error) {
	xmlBlob, err := extractProvisionPlist(raw)
	if err != nil {
		return nil, err
	}

	dec := xml.NewDecoder(strings.NewReader(string(xmlBlob)))
	info := &provisionInfo{}

	var (
		currentKey  string
		expectArray bool
		arrayBuf    []string
	)

	for {
		tok, err := dec.Token()
		if err != nil {
			break
		}
		switch t := tok.(type) {
		case xml.StartElement:
			switch t.Name.Local {
			case "key":
				var v string
				if err := dec.DecodeElement(&v, &t); err == nil {
					currentKey = v
				}
			case "string":
				var v string
				if err := dec.DecodeElement(&v, &t); err == nil {
					if expectArray {
						arrayBuf = append(arrayBuf, v)
					} else {
						applyProvisionString(info, currentKey, v)
						currentKey = ""
					}
				}
			case "date":
				var v string
				if err := dec.DecodeElement(&v, &t); err == nil {
					if parsed, perr := time.Parse(time.RFC3339, v); perr == nil {
						applyProvisionDate(info, currentKey, parsed)
					}
					currentKey = ""
				}
			case "true":
				_ = dec.Skip()
				applyProvisionBool(info, currentKey, true)
				currentKey = ""
			case "false":
				_ = dec.Skip()
				applyProvisionBool(info, currentKey, false)
				currentKey = ""
			case "integer":
				var v string
				if err := dec.DecodeElement(&v, &t); err == nil {
					applyProvisionString(info, currentKey, v)
					currentKey = ""
				}
			case "array":
				if currentKey == "ProvisionedDevices" {
					expectArray = true
					arrayBuf = nil
				}
			case "dict":
				// Skip nested dicts (e.g. Entitlements) so their inner
				// <key>s don't pollute our top-level state machine.
				_ = dec.Skip()
			}
		case xml.EndElement:
			if t.Name.Local == "array" && expectArray {
				info.ProvisionedDevices = append(info.ProvisionedDevices, arrayBuf...)
				arrayBuf = nil
				expectArray = false
				currentKey = ""
			}
		}
	}

	info.Kind = classifyProvisionKind(info)
	if info.TeamID == "" && info.ApplicationID != "" {
		// application-identifier is "<TeamID>.<bundle id or pattern>";
		// the prefix gives us the Team ID for free when TeamIdentifier
		// is absent.
		if dot := strings.IndexByte(info.ApplicationID, '.'); dot > 0 {
			info.TeamID = info.ApplicationID[:dot]
		}
	}
	return info, nil
}

func applyProvisionString(info *provisionInfo, key, value string) {
	switch key {
	case "Name":
		info.Name = value
	case "AppIDName":
		info.AppIDName = value
	case "TeamName":
		info.TeamName = value
	case "TeamIdentifier":
		// Sometimes encoded as a single <string>, sometimes as <array><string>...
		// the array branch is handled separately.
		if info.TeamID == "" {
			info.TeamID = value
		}
	case "ApplicationIdentifierPrefix":
		if info.TeamID == "" {
			info.TeamID = value
		}
	case "application-identifier":
		info.ApplicationID = value
	}
}

func applyProvisionDate(info *provisionInfo, key string, t time.Time) {
	switch key {
	case "ExpirationDate":
		info.ExpirationDate = &t
	case "CreationDate":
		info.CreationDate = &t
	}
}

func applyProvisionBool(info *provisionInfo, key string, b bool) {
	switch key {
	case "ProvisionsAllDevices":
		info.ProvisionsAllDevices = b
	case "get-task-allow":
		info.GetTaskAllow = b
	}
}

func classifyProvisionKind(info *provisionInfo) string {
	switch {
	case info.ProvisionsAllDevices:
		return "enterprise"
	case len(info.ProvisionedDevices) > 0 && info.GetTaskAllow:
		return "development"
	case len(info.ProvisionedDevices) > 0:
		return "ad_hoc"
	default:
		return "app_store"
	}
}

// ---- p12 -----------------------------------------------------------------

type certificateInfo struct {
	CommonName string
	TeamID     string
	NotAfter   time.Time
	NotBefore  time.Time
	Issuer     string
}

// parseP12Certificate uses the frozen pkcs12 package to decrypt the
// container with the user's password. We surface the leaf certificate's
// CN, expiry, and a Team ID guess from the Subject's OU values (Apple
// uses a 10-character alphanumeric OU on every developer cert).
func parseP12Certificate(blob []byte, password string) (*certificateInfo, error) {
	if len(blob) == 0 {
		return nil, errors.New("empty p12 blob")
	}
	_, cert, err := pkcs12.Decode(blob, password)
	if err != nil {
		// Distinguish wrong-password errors from format errors so the
		// handler can return a more helpful 400.
		if errors.Is(err, pkcs12.ErrIncorrectPassword) {
			return nil, errIOSCertWrongPassword
		}
		return nil, fmt.Errorf("pkcs12 decode: %w", err)
	}
	return certificateInfoFromX509(cert), nil
}

var errIOSCertWrongPassword = errors.New("pkcs12: incorrect password")

func certificateInfoFromX509(cert *x509.Certificate) *certificateInfo {
	if cert == nil {
		return nil
	}
	info := &certificateInfo{
		CommonName: cert.Subject.CommonName,
		NotAfter:   cert.NotAfter,
		NotBefore:  cert.NotBefore,
		Issuer:     cert.Issuer.CommonName,
	}
	for _, ou := range cert.Subject.OrganizationalUnit {
		if looksLikeAppleTeamID(ou) {
			info.TeamID = ou
			break
		}
	}
	return info
}

var teamIDPattern = regexp.MustCompile(`^[A-Z0-9]{10}$`)

func looksLikeAppleTeamID(s string) bool {
	return teamIDPattern.MatchString(s)
}
