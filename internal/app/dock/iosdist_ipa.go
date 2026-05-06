package dock

// IPA introspection. An IPA is a ZIP that contains exactly one
// `Payload/<App>.app/` directory; inside it lives an Info.plist (XML
// or binary) plus, optionally, an `embedded.mobileprovision`. We extract
// the few fields the platform actually uses (bundle id, version, build,
// display name, minimum OS), surface them to the upload handler, and
// cross-check against the parent app's bundle id.

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"

	"howett.net/plist"
)

type ipaInfo struct {
	BundleID            string
	BundleVersion       string // CFBundleVersion (build number)
	BundleShortVersion  string // CFBundleShortVersionString (display version)
	BundleDisplayName   string // CFBundleDisplayName ?? CFBundleName
	MinimumOSVersion    string
	HasEmbeddedProvProf bool

	// Icon is best-effort: when the build flow leaves PNGs in the .app
	// directory (or an iTunesArtwork file at the root), we surface the
	// largest one found. Modern Assets.car-only builds yield nothing here
	// and the upload UI falls back to manual upload.
	IconBytes       []byte
	IconFilename    string // original filename inside the zip; useful for content-type guess
	IconContentType string
}

// parseIPA reads the IPA at path and returns the parsed Info.plist
// fields. Errors fall into three buckets:
//
//   - file not a zip → ErrIPANotZip
//   - zip OK but no Payload/*.app/Info.plist → ErrIPAMissingInfoPlist
//   - plist found but failed to decode → wrapped error from howett.net/plist
//
// Callers that just want best-effort metadata should treat any error as
// "no metadata available" and continue with user-entered fields.
func parseIPA(ipaPath string) (*ipaInfo, error) {
	zr, err := zip.OpenReader(ipaPath)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errIPANotZip, err)
	}
	defer zr.Close()

	var (
		infoPlistFile *zip.File
		hasProvProf   bool
		appPrefix     string // "Payload/<Whatever>.app/"
	)
	for _, f := range zr.File {
		clean := path.Clean(f.Name)
		if infoPlistFile == nil && isPayloadInfoPlist(clean) {
			infoPlistFile = f
			appPrefix = strings.TrimSuffix(clean, "Info.plist")
		}
		if !hasProvProf && isPayloadEmbeddedProfile(clean) {
			hasProvProf = true
		}
	}
	if infoPlistFile == nil {
		return nil, errIPAMissingInfoPlist
	}

	rc, err := infoPlistFile.Open()
	if err != nil {
		return nil, fmt.Errorf("open Info.plist: %w", err)
	}
	defer rc.Close()
	raw, err := io.ReadAll(rc)
	if err != nil {
		return nil, fmt.Errorf("read Info.plist: %w", err)
	}

	// howett.net/plist auto-detects XML vs binary plists.
	var dict map[string]any
	if _, err := plist.Unmarshal(raw, &dict); err != nil {
		return nil, fmt.Errorf("decode Info.plist: %w", err)
	}

	info := &ipaInfo{
		BundleID:            stringFromPlist(dict, "CFBundleIdentifier"),
		BundleVersion:       stringFromPlist(dict, "CFBundleVersion"),
		BundleShortVersion:  stringFromPlist(dict, "CFBundleShortVersionString"),
		MinimumOSVersion:    stringFromPlist(dict, "MinimumOSVersion"),
		HasEmbeddedProvProf: hasProvProf,
	}
	for _, k := range []string{"CFBundleDisplayName", "CFBundleName", "CFBundleExecutable"} {
		if v := stringFromPlist(dict, k); v != "" {
			info.BundleDisplayName = v
			break
		}
	}

	// Icon extraction is best-effort. Modern Assets.car-only builds will
	// silently end up here with no icon; the UI's manual-upload button is
	// the answer. Failures bubble up as empty bytes, never as errors.
	if iconFile := findIPAIconEntry(zr.File, dict, appPrefix); iconFile != nil {
		if iconRC, err := iconFile.Open(); err == nil {
			if iconBytes, err := io.ReadAll(iconRC); err == nil {
				info.IconBytes = iconBytes
				info.IconFilename = path.Base(iconFile.Name)
				info.IconContentType = guessIconContentType(iconFile.Name)
			}
			_ = iconRC.Close()
		}
	}

	return info, nil
}

// findIPAIconEntry walks a priority list of icon paths and returns the
// first present zip entry. Priority is loosely "biggest first" — older
// iTunesArtwork files are 1024×1024 in modern builds; AppIcon-1024 is
// emitted by some custom build setups; otherwise we fall back to
// CFBundleIcons file names with @3x/@2x suffixes (180×180 / 120×120),
// then 76×76 ipad variants, then anything matching *Icon*.png.
func findIPAIconEntry(files []*zip.File, dict map[string]any, appPrefix string) *zip.File {
	candidates := []string{
		"iTunesArtwork@2x",
		"iTunesArtwork",
		appPrefix + "iTunesArtwork",
		appPrefix + "AppIcon-1024.png",
		appPrefix + "AppIcon-1024x1024.png",
		appPrefix + "AppIcon1024x1024.png",
		appPrefix + "AppIcon-Marketing.png",
	}
	for _, name := range cfBundleIconNames(dict) {
		// Order: @3x (180), @2x (120), 76x76@2x (152, ipad), 76x76 (76)
		// then bare. Real-world hits are usually @2x or @3x.
		candidates = append(candidates,
			appPrefix+name+"@3x.png",
			appPrefix+name+"@2x.png",
			appPrefix+name+"@2x~ipad.png",
			appPrefix+name+"~ipad.png",
			appPrefix+name+".png",
		)
	}
	// Final defaults that some Xcode versions still emit.
	candidates = append(candidates,
		appPrefix+"AppIcon60x60@3x.png",
		appPrefix+"AppIcon60x60@2x.png",
		appPrefix+"AppIcon76x76@2x~ipad.png",
		appPrefix+"AppIcon76x76.png",
	)

	byName := make(map[string]*zip.File, len(files))
	for _, f := range files {
		byName[f.Name] = f
	}
	for _, c := range candidates {
		if f, ok := byName[c]; ok {
			return f
		}
	}
	return nil
}

// cfBundleIconNames pulls the icon-name prefixes the app declared in its
// Info.plist. We prefer CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles
// over the deprecated CFBundleIconFiles top-level key, and de-dup.
func cfBundleIconNames(dict map[string]any) []string {
	var names []string
	if icons, ok := dict["CFBundleIcons"].(map[string]any); ok {
		if primary, ok := icons["CFBundlePrimaryIcon"].(map[string]any); ok {
			if files, ok := primary["CFBundleIconFiles"].([]any); ok {
				for _, n := range files {
					if s, ok := n.(string); ok && s != "" {
						names = append(names, s)
					}
				}
			}
		}
	}
	if files, ok := dict["CFBundleIconFiles"].([]any); ok {
		for _, n := range files {
			if s, ok := n.(string); ok && s != "" {
				names = append(names, s)
			}
		}
	}
	if v, ok := dict["CFBundleIconFile"].(string); ok && v != "" {
		names = append(names, v)
	}
	// De-dup while preserving order.
	seen := make(map[string]struct{}, len(names))
	uniq := names[:0]
	for _, n := range names {
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		uniq = append(uniq, n)
	}
	return uniq
}

func guessIconContentType(name string) string {
	switch strings.ToLower(path.Ext(name)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	}
	// iTunesArtwork has no extension and is historically a JPEG.
	if strings.HasPrefix(path.Base(name), "iTunesArtwork") {
		return "image/jpeg"
	}
	return "application/octet-stream"
}

var (
	errIPANotZip            = errors.New("ipa: not a zip archive")
	errIPAMissingInfoPlist  = errors.New("ipa: Info.plist not found")
)

func isPayloadInfoPlist(clean string) bool {
	if !strings.HasPrefix(clean, "Payload/") {
		return false
	}
	rest := strings.TrimPrefix(clean, "Payload/")
	parts := strings.Split(rest, "/")
	if len(parts) != 2 {
		return false
	}
	if !strings.HasSuffix(parts[0], ".app") {
		return false
	}
	return parts[1] == "Info.plist"
}

func isPayloadEmbeddedProfile(clean string) bool {
	if !strings.HasPrefix(clean, "Payload/") {
		return false
	}
	rest := strings.TrimPrefix(clean, "Payload/")
	parts := strings.Split(rest, "/")
	if len(parts) != 2 {
		return false
	}
	if !strings.HasSuffix(parts[0], ".app") {
		return false
	}
	return parts[1] == "embedded.mobileprovision"
}

// stringFromPlist coerces dict[key] into a string. Numeric and boolean
// values get formatted in the way Apple's tooling renders them so the
// downstream UI shows something familiar (e.g. MinimumOSVersion may be
// stored as a number in some toolchains' output).
func stringFromPlist(d map[string]any, key string) string {
	v, ok := d[key]
	if !ok || v == nil {
		return ""
	}
	switch x := v.(type) {
	case string:
		return x
	case bool:
		if x {
			return "YES"
		}
		return "NO"
	case float64:
		return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.6f", x), "0"), ".")
	case int, int8, int16, int32, int64:
		return fmt.Sprintf("%d", x)
	case uint, uint8, uint16, uint32, uint64:
		return fmt.Sprintf("%d", x)
	default:
		return fmt.Sprintf("%v", v)
	}
}
