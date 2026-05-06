package dock

// Storage layer for the iOS distribution module. Tables are declared in
// store.go schema (iosdist_apps, iosdist_versions, iosdist_install_tokens).

import (
	"database/sql"
	"errors"
	"time"
)

type IOSApp struct {
	ID              int64     `json:"id"`
	OwnerUserID     string    `json:"owner_user_id"`
	Name            string    `json:"name"`
	BundleID        string    `json:"bundle_id"`
	Description     string    `json:"description"`
	IconURL         string    `json:"icon_url"`
	IconSource      string    `json:"icon_source"`     // '' | 'ipa' | 'manual' | 'asc'
	TestFlightURL   string    `json:"testflight_url"`  // empty means not configured
	ASCAppID        string    `json:"asc_app_id"`      // App Store Connect app id
	ASCBetaGroupID  string    `json:"asc_beta_group_id"`
	PublicSlug      string    `json:"public_slug"`
	IsPublic        bool      `json:"is_public"`
	Keywords        string    `json:"keywords"`         // comma-separated, ASC localization
	WhatsNew        string    `json:"whats_new"`        // latest ASC version's "what's new"
	PromotionalText string    `json:"promotional_text"` // ASC localization
	MarketingURL    string    `json:"marketing_url"`    // ASC localization
	SupportURL      string    `json:"support_url"`      // ASC localization
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// IOSTestRequest is one "申请测试" submission from the public app page.
type IOSTestRequest struct {
	ID          int64      `json:"id"`
	AppID       int64      `json:"app_id"`
	Email       string     `json:"email"`
	FirstName   string     `json:"first_name"`
	LastName    string     `json:"last_name"`
	Status      string     `json:"status"` // pending|sent|failed
	ASCResponse string     `json:"asc_response"`
	SourceIP    string     `json:"source_ip"`
	UserAgent   string     `json:"user_agent"`
	CreatedAt   time.Time  `json:"created_at"`
	ProcessedAt *time.Time `json:"processed_at,omitempty"`
}

// IOSASCConfig is the per-owner App Store Connect API key set. The
// p8_cipher field stays plain on the struct (we don't want it spilled
// into JSON responses) — see store funcs for read/write helpers.
type IOSASCConfig struct {
	OwnerUserID        string    `json:"owner_user_id"`
	IssuerID           string    `json:"issuer_id"`
	KeyID              string    `json:"key_id"`
	P8Filename         string    `json:"p8_filename"`
	P8Encrypted        bool      `json:"p8_encrypted"`
	AccountHolderEmail string    `json:"account_holder_email"`
	TeamName           string    `json:"team_name"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`

	// p8Cipher mirrors the DB column. Unexported to keep secrets out of
	// JSON; the ASC client reads it through getIOSASCConfigSecret.
	p8Cipher string
}

type IOSVersion struct {
	ID               int64     `json:"id"`
	AppID            int64     `json:"app_id"`
	Version          string    `json:"version"`
	BuildNumber      string    `json:"build_number"`
	IPAUrl           string    `json:"ipa_url"`
	IPAFilename      string    `json:"ipa_filename"`
	IPASize          int64     `json:"ipa_size"`
	IPASHA256        string    `json:"ipa_sha256"`
	ReleaseNotes     string    `json:"release_notes"`
	IsSigned         bool      `json:"is_signed"`
	DistributionType string    `json:"distribution_type"` // app_store|enterprise|ad_hoc|development
	IPABundleID      string    `json:"ipa_bundle_id"`
	IPAShortVersion  string    `json:"ipa_short_version"`
	IPABuildNumber   string    `json:"ipa_build_number"`
	IPADisplayName   string    `json:"ipa_display_name"`
	IPAMinOS         string    `json:"ipa_min_os"`
	IPAHasEmbeddedPP bool      `json:"ipa_has_embedded_profile"`
	CreatedAt        time.Time `json:"created_at"`
}

// IOSCertificate is a user-supplied .p12 (or other-format) signing cert.
// The actual file is stored via AttachmentStorage and only referenced by URL;
// the password (if any) is encrypted at rest when IOSDIST_RESOURCE_KEY is set.
type IOSCertificate struct {
	ID                int64      `json:"id"`
	OwnerUserID       string     `json:"owner_user_id"`
	Name              string     `json:"name"`
	Kind              string     `json:"kind"` // distribution|development|enterprise|adhoc
	FileURL           string     `json:"file_url"`
	FileFilename      string     `json:"file_filename"`
	FileSize          int64      `json:"file_size"`
	PasswordEncrypted bool       `json:"password_encrypted"`
	HasPassword       bool       `json:"has_password"`
	TeamID            string     `json:"team_id"`
	CommonName        string     `json:"common_name"`
	Notes             string     `json:"notes"`
	ExpiresAt         *time.Time `json:"expires_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
	UpdatedAt         time.Time  `json:"updated_at"`

	// passwordCipher is the at-rest password column. Unexported so it
	// never ships to API consumers; the signing pipeline (M3) reads
	// this through decryptIOSDistSecret.
	passwordCipher string
}

// IOSProvisioningProfile is a user-supplied .mobileprovision file.
// We don't parse the embedded plist here yet (CMS unwrap + plist) —
// metadata fields are filled in from the upload form for now.
type IOSProvisioningProfile struct {
	ID           int64      `json:"id"`
	OwnerUserID  string     `json:"owner_user_id"`
	Name         string     `json:"name"`
	Kind         string     `json:"kind"` // app_store|ad_hoc|enterprise|development
	FileURL      string     `json:"file_url"`
	FileFilename string     `json:"file_filename"`
	FileSize     int64      `json:"file_size"`
	AppID        string     `json:"app_id"`
	TeamID       string     `json:"team_id"`
	UDIDCount    int        `json:"udid_count"`
	Notes        string     `json:"notes"`
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type IOSInstallToken struct {
	Token          string     `json:"token"`
	VersionID      int64      `json:"version_id"`
	CreatedBy      string     `json:"created_by"`
	ExpiresAt      time.Time  `json:"expires_at"`
	CreatedAt      time.Time  `json:"created_at"`
	LastAccessedAt *time.Time `json:"last_accessed_at,omitempty"`
	AccessCount    int        `json:"access_count"`
}

func (s *Server) createIOSApp(app *IOSApp) error {
	if app == nil {
		return errors.New("ios app is nil")
	}
	now := time.Now()
	app.CreatedAt = now
	app.UpdatedAt = now
	if app.PublicSlug == "" {
		slug, err := s.generateUniqueIOSAppSlug()
		if err != nil {
			return err
		}
		app.PublicSlug = slug
	}
	return s.db.QueryRow(
		`INSERT INTO iosdist_apps (owner_user_id, name, bundle_id, description, icon_url, public_slug, is_public, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
		app.OwnerUserID, app.Name, app.BundleID, app.Description, app.IconURL, app.PublicSlug, app.IsPublic, now,
	).Scan(&app.ID)
}

// backfillIOSAppSlugs assigns a public_slug to legacy rows that pre-date
// the column. Idempotent and cheap — typical instance has < 100 apps.
func (s *Server) backfillIOSAppSlugs() error {
	rows, err := s.db.Query(`SELECT id FROM iosdist_apps WHERE public_slug = ''`)
	if err != nil {
		return err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, id := range ids {
		slug, err := s.generateUniqueIOSAppSlug()
		if err != nil {
			return err
		}
		if _, err := s.db.Exec(`UPDATE iosdist_apps SET public_slug = $1 WHERE id = $2`, slug, id); err != nil {
			return err
		}
	}
	return nil
}

// generateUniqueIOSAppSlug returns a URL-safe ~10-char id that doesn't
// collide with an existing row. Collision space is ~62^10 ≈ 8e17 so a
// single retry round is overkill in practice — we still do it because
// the unique index would surface a confusing error otherwise.
func (s *Server) generateUniqueIOSAppSlug() (string, error) {
	for attempts := 0; attempts < 5; attempts++ {
		candidate := generateSessionID()
		// Strip URL-unsafe chars and clip to 10. base64url already
		// avoids '/' and '+', so this is just length normalization.
		clean := make([]byte, 0, 10)
		for i := 0; i < len(candidate) && len(clean) < 10; i++ {
			c := candidate[i]
			if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
				clean = append(clean, c)
			}
		}
		slug := string(clean)
		if len(slug) < 8 {
			continue
		}
		var existing int64
		err := s.db.QueryRow(`SELECT id FROM iosdist_apps WHERE public_slug = $1 LIMIT 1`, slug).Scan(&existing)
		if errors.Is(err, sql.ErrNoRows) {
			return slug, nil
		}
		if err != nil {
			return "", err
		}
	}
	return "", errors.New("could not generate unique app slug after 5 attempts")
}

// listPublicIOSApps powers the plaza page. Sorted by updated_at so
// recently-touched apps surface first. Caller paginates via limit/offset.
func (s *Server) listPublicIOSApps(limit, offset int) ([]IOSApp, error) {
	if limit <= 0 || limit > 100 {
		limit = 24
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := s.db.Query(
		`SELECT id, owner_user_id, name, bundle_id, description, icon_url, icon_source, testflight_url, asc_app_id, asc_beta_group_id, public_slug, is_public, keywords, whats_new, promotional_text, marketing_url, support_url, created_at, updated_at
		 FROM iosdist_apps WHERE is_public = TRUE ORDER BY updated_at DESC LIMIT $1 OFFSET $2`,
		limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IOSApp
	for rows.Next() {
		var a IOSApp
		if err := rows.Scan(&a.ID, &a.OwnerUserID, &a.Name, &a.BundleID, &a.Description, &a.IconURL, &a.IconSource, &a.TestFlightURL, &a.ASCAppID, &a.ASCBetaGroupID, &a.PublicSlug, &a.IsPublic, &a.Keywords, &a.WhatsNew, &a.PromotionalText, &a.MarketingURL, &a.SupportURL, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (s *Server) countPublicIOSApps() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM iosdist_apps WHERE is_public = TRUE`).Scan(&n)
	return n, err
}

// getIOSAppBySlug is the public-page lookup. Owner check is intentionally
// absent — the slug is the auth token. Caller still gates on is_public.
func (s *Server) getIOSAppBySlug(slug string) (*IOSApp, error) {
	if slug == "" {
		return nil, nil
	}
	var a IOSApp
	err := s.db.QueryRow(
		`SELECT id, owner_user_id, name, bundle_id, description, icon_url, icon_source, testflight_url, asc_app_id, asc_beta_group_id, public_slug, is_public, keywords, whats_new, promotional_text, marketing_url, support_url, created_at, updated_at
		 FROM iosdist_apps WHERE public_slug = $1`,
		slug,
	).Scan(&a.ID, &a.OwnerUserID, &a.Name, &a.BundleID, &a.Description, &a.IconURL, &a.IconSource, &a.TestFlightURL, &a.ASCAppID, &a.ASCBetaGroupID, &a.PublicSlug, &a.IsPublic, &a.Keywords, &a.WhatsNew, &a.PromotionalText, &a.MarketingURL, &a.SupportURL, &a.CreatedAt, &a.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// setIOSAppNameAndDescription writes name + description without touching
// other fields. Used by the ASC meta sync. Empty strings overwrite (so
// caller must guard if it doesn't want that).
func (s *Server) setIOSAppNameAndDescription(id int64, ownerUserID, name, description string) error {
	_, err := s.db.Exec(
		`UPDATE iosdist_apps SET name = $1, description = $2, updated_at = $3
		 WHERE id = $4 AND owner_user_id = $5`,
		name, description, time.Now(), id, ownerUserID,
	)
	return err
}

// IOSAppMetaUpdate is the bundle of metadata fields that the ASC sync
// can refresh. Empty fields are written — callers should pass through
// existing values for fields ASC didn't return.
type IOSAppMetaUpdate struct {
	Name            string
	Description     string
	Keywords        string
	WhatsNew        string
	PromotionalText string
	MarketingURL    string
	SupportURL      string
}

func (s *Server) setIOSAppMeta(id int64, ownerUserID string, m IOSAppMetaUpdate) error {
	_, err := s.db.Exec(
		`UPDATE iosdist_apps
		 SET name = $1, description = $2, keywords = $3, whats_new = $4, promotional_text = $5,
		     marketing_url = $6, support_url = $7, updated_at = $8
		 WHERE id = $9 AND owner_user_id = $10`,
		m.Name, m.Description, m.Keywords, m.WhatsNew, m.PromotionalText, m.MarketingURL, m.SupportURL,
		time.Now(), id, ownerUserID,
	)
	return err
}

func (s *Server) setIOSAppPublicVisibility(id int64, ownerUserID string, isPublic bool) error {
	_, err := s.db.Exec(
		`UPDATE iosdist_apps SET is_public = $1, updated_at = $2
		 WHERE id = $3 AND owner_user_id = $4`,
		isPublic, time.Now(), id, ownerUserID,
	)
	return err
}

func (s *Server) listIOSApps(ownerUserID string) ([]IOSApp, error) {
	rows, err := s.db.Query(
		`SELECT id, owner_user_id, name, bundle_id, description, icon_url, icon_source, testflight_url, asc_app_id, asc_beta_group_id, public_slug, is_public, keywords, whats_new, promotional_text, marketing_url, support_url, created_at, updated_at
		 FROM iosdist_apps WHERE owner_user_id = $1 ORDER BY updated_at DESC`,
		ownerUserID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var apps []IOSApp
	for rows.Next() {
		var a IOSApp
		if err := rows.Scan(&a.ID, &a.OwnerUserID, &a.Name, &a.BundleID, &a.Description, &a.IconURL, &a.IconSource, &a.TestFlightURL, &a.ASCAppID, &a.ASCBetaGroupID, &a.PublicSlug, &a.IsPublic, &a.Keywords, &a.WhatsNew, &a.PromotionalText, &a.MarketingURL, &a.SupportURL, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		apps = append(apps, a)
	}
	return apps, rows.Err()
}

// getIOSAppByID fetches an app without an owner check. Only callers that
// have already authorized via a separate channel (e.g. an install token
// bound to a specific version) should use this — keep the owner-scoped
// getIOSApp for the user-facing handlers.
func (s *Server) getIOSAppByID(id int64) (*IOSApp, error) {
	var a IOSApp
	err := s.db.QueryRow(
		`SELECT id, owner_user_id, name, bundle_id, description, icon_url, icon_source, testflight_url, asc_app_id, asc_beta_group_id, public_slug, is_public, keywords, whats_new, promotional_text, marketing_url, support_url, created_at, updated_at
		 FROM iosdist_apps WHERE id = $1`,
		id,
	).Scan(&a.ID, &a.OwnerUserID, &a.Name, &a.BundleID, &a.Description, &a.IconURL, &a.IconSource, &a.TestFlightURL, &a.ASCAppID, &a.ASCBetaGroupID, &a.PublicSlug, &a.IsPublic, &a.Keywords, &a.WhatsNew, &a.PromotionalText, &a.MarketingURL, &a.SupportURL, &a.CreatedAt, &a.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (s *Server) getIOSApp(id int64, ownerUserID string) (*IOSApp, error) {
	var a IOSApp
	err := s.db.QueryRow(
		`SELECT id, owner_user_id, name, bundle_id, description, icon_url, icon_source, testflight_url, asc_app_id, asc_beta_group_id, public_slug, is_public, keywords, whats_new, promotional_text, marketing_url, support_url, created_at, updated_at
		 FROM iosdist_apps WHERE id = $1 AND owner_user_id = $2`,
		id, ownerUserID,
	).Scan(&a.ID, &a.OwnerUserID, &a.Name, &a.BundleID, &a.Description, &a.IconURL, &a.IconSource, &a.TestFlightURL, &a.ASCAppID, &a.ASCBetaGroupID, &a.PublicSlug, &a.IsPublic, &a.Keywords, &a.WhatsNew, &a.PromotionalText, &a.MarketingURL, &a.SupportURL, &a.CreatedAt, &a.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (s *Server) deleteIOSApp(id int64, ownerUserID string) error {
	_, err := s.db.Exec(`DELETE FROM iosdist_apps WHERE id = $1 AND owner_user_id = $2`, id, ownerUserID)
	return err
}

func (s *Server) touchIOSApp(id int64) error {
	_, err := s.db.Exec(`UPDATE iosdist_apps SET updated_at = $1 WHERE id = $2`, time.Now(), id)
	return err
}

// setIOSAppIcon writes the icon URL + source. The source field guards
// against future IPA uploads silently overwriting a manual icon — see
// the icon-resolution note on IOSApp.
func (s *Server) setIOSAppIcon(id int64, ownerUserID, iconURL, source string) error {
	_, err := s.db.Exec(
		`UPDATE iosdist_apps SET icon_url = $1, icon_source = $2, updated_at = $3
		 WHERE id = $4 AND owner_user_id = $5`,
		iconURL, source, time.Now(), id, ownerUserID,
	)
	return err
}

func (s *Server) setIOSAppTestFlightURL(id int64, ownerUserID, url string) error {
	_, err := s.db.Exec(
		`UPDATE iosdist_apps SET testflight_url = $1, updated_at = $2
		 WHERE id = $3 AND owner_user_id = $4`,
		url, time.Now(), id, ownerUserID,
	)
	return err
}

func (s *Server) setIOSAppASCBinding(id int64, ownerUserID, ascAppID, ascBetaGroupID string) error {
	_, err := s.db.Exec(
		`UPDATE iosdist_apps SET asc_app_id = $1, asc_beta_group_id = $2, updated_at = $3
		 WHERE id = $4 AND owner_user_id = $5`,
		ascAppID, ascBetaGroupID, time.Now(), id, ownerUserID,
	)
	return err
}

// ---- ASC config ---------------------------------------------------------

func (s *Server) upsertIOSASCConfig(cfg *IOSASCConfig) error {
	if cfg == nil {
		return errors.New("asc config is nil")
	}
	now := time.Now()
	cfg.UpdatedAt = now
	_, err := s.db.Exec(
		`INSERT INTO iosdist_asc_configs (owner_user_id, issuer_id, key_id, p8_cipher, p8_filename, p8_encrypted, account_holder_email, team_name, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
		 ON CONFLICT (owner_user_id) DO UPDATE
		   SET issuer_id            = EXCLUDED.issuer_id,
		       key_id               = EXCLUDED.key_id,
		       p8_cipher            = EXCLUDED.p8_cipher,
		       p8_filename          = EXCLUDED.p8_filename,
		       p8_encrypted         = EXCLUDED.p8_encrypted,
		       account_holder_email = EXCLUDED.account_holder_email,
		       team_name            = EXCLUDED.team_name,
		       updated_at           = EXCLUDED.updated_at`,
		cfg.OwnerUserID, cfg.IssuerID, cfg.KeyID, cfg.p8Cipher, cfg.P8Filename, cfg.P8Encrypted, cfg.AccountHolderEmail, cfg.TeamName, now,
	)
	if err == nil && cfg.CreatedAt.IsZero() {
		cfg.CreatedAt = now
	}
	return err
}

func (s *Server) setIOSASCConfigAccountInfo(ownerUserID, email, teamName string) error {
	_, err := s.db.Exec(
		`UPDATE iosdist_asc_configs SET account_holder_email = $1, team_name = $2, updated_at = $3
		 WHERE owner_user_id = $4`,
		email, teamName, time.Now(), ownerUserID,
	)
	return err
}

func (s *Server) getIOSASCConfig(ownerUserID string) (*IOSASCConfig, error) {
	var c IOSASCConfig
	err := s.db.QueryRow(
		`SELECT owner_user_id, issuer_id, key_id, p8_cipher, p8_filename, p8_encrypted, account_holder_email, team_name, created_at, updated_at
		 FROM iosdist_asc_configs WHERE owner_user_id = $1`,
		ownerUserID,
	).Scan(&c.OwnerUserID, &c.IssuerID, &c.KeyID, &c.p8Cipher, &c.P8Filename, &c.P8Encrypted, &c.AccountHolderEmail, &c.TeamName, &c.CreatedAt, &c.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &c, nil
}

// ---- Test requests -------------------------------------------------------

func (s *Server) createIOSTestRequest(r *IOSTestRequest) error {
	if r == nil {
		return errors.New("test request is nil")
	}
	r.CreatedAt = time.Now()
	if r.Status == "" {
		r.Status = "pending"
	}
	return s.db.QueryRow(
		`INSERT INTO iosdist_test_requests
			(app_id, email, first_name, last_name, status, asc_response, source_ip, user_agent, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
		r.AppID, r.Email, r.FirstName, r.LastName, r.Status, r.ASCResponse, r.SourceIP, r.UserAgent, r.CreatedAt,
	).Scan(&r.ID)
}

func (s *Server) markIOSTestRequest(id int64, status, ascResponse string) error {
	now := time.Now()
	_, err := s.db.Exec(
		`UPDATE iosdist_test_requests SET status = $1, asc_response = $2, processed_at = $3 WHERE id = $4`,
		status, ascResponse, now, id,
	)
	return err
}

func (s *Server) listIOSTestRequests(appID int64, limit int) ([]IOSTestRequest, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.db.Query(
		`SELECT id, app_id, email, first_name, last_name, status, asc_response, source_ip, user_agent, created_at, processed_at
		 FROM iosdist_test_requests WHERE app_id = $1 ORDER BY created_at DESC LIMIT $2`,
		appID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IOSTestRequest
	for rows.Next() {
		var r IOSTestRequest
		if err := rows.Scan(&r.ID, &r.AppID, &r.Email, &r.FirstName, &r.LastName, &r.Status, &r.ASCResponse, &r.SourceIP, &r.UserAgent, &r.CreatedAt, &r.ProcessedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// countIOSTestRequestsByEmail is the rate-limit primitive: how many
// requests for this app + email arrived in the trailing window.
func (s *Server) countIOSTestRequestsByEmail(appID int64, email string, since time.Time) (int, error) {
	var n int
	err := s.db.QueryRow(
		`SELECT COUNT(*) FROM iosdist_test_requests WHERE app_id = $1 AND email = $2 AND created_at >= $3`,
		appID, email, since,
	).Scan(&n)
	return n, err
}

func (s *Server) deleteIOSASCConfig(ownerUserID string) error {
	_, err := s.db.Exec(`DELETE FROM iosdist_asc_configs WHERE owner_user_id = $1`, ownerUserID)
	return err
}

const iosVersionColumns = `id, app_id, version, build_number, ipa_url, ipa_filename, ipa_size, ipa_sha256, release_notes, is_signed, distribution_type,
	ipa_bundle_id, ipa_short_version, ipa_build_number, ipa_display_name, ipa_min_os, ipa_has_embedded_profile, created_at`

func scanIOSVersion(rs interface {
	Scan(dest ...any) error
}, v *IOSVersion) error {
	return rs.Scan(
		&v.ID, &v.AppID, &v.Version, &v.BuildNumber, &v.IPAUrl, &v.IPAFilename, &v.IPASize, &v.IPASHA256, &v.ReleaseNotes, &v.IsSigned, &v.DistributionType,
		&v.IPABundleID, &v.IPAShortVersion, &v.IPABuildNumber, &v.IPADisplayName, &v.IPAMinOS, &v.IPAHasEmbeddedPP, &v.CreatedAt,
	)
}

func (s *Server) createIOSVersion(v *IOSVersion) error {
	if v == nil {
		return errors.New("ios version is nil")
	}
	v.CreatedAt = time.Now()
	return s.db.QueryRow(
		`INSERT INTO iosdist_versions (app_id, version, build_number, ipa_url, ipa_filename, ipa_size, ipa_sha256, release_notes, is_signed, distribution_type,
			ipa_bundle_id, ipa_short_version, ipa_build_number, ipa_display_name, ipa_min_os, ipa_has_embedded_profile, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`,
		v.AppID, v.Version, v.BuildNumber, v.IPAUrl, v.IPAFilename, v.IPASize, v.IPASHA256, v.ReleaseNotes, v.IsSigned, v.DistributionType,
		v.IPABundleID, v.IPAShortVersion, v.IPABuildNumber, v.IPADisplayName, v.IPAMinOS, v.IPAHasEmbeddedPP, v.CreatedAt,
	).Scan(&v.ID)
}

func (s *Server) listIOSVersions(appID int64) ([]IOSVersion, error) {
	rows, err := s.db.Query(
		`SELECT `+iosVersionColumns+`
		 FROM iosdist_versions WHERE app_id = $1 ORDER BY created_at DESC`,
		appID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IOSVersion
	for rows.Next() {
		var v IOSVersion
		if err := scanIOSVersion(rows, &v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Server) getIOSVersion(id int64) (*IOSVersion, error) {
	var v IOSVersion
	row := s.db.QueryRow(`SELECT `+iosVersionColumns+` FROM iosdist_versions WHERE id = $1`, id)
	if err := scanIOSVersion(row, &v); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &v, nil
}

func (s *Server) deleteIOSVersion(id int64) error {
	_, err := s.db.Exec(`DELETE FROM iosdist_versions WHERE id = $1`, id)
	return err
}

func (s *Server) createIOSInstallToken(t *IOSInstallToken) error {
	if t == nil {
		return errors.New("install token is nil")
	}
	t.CreatedAt = time.Now()
	_, err := s.db.Exec(
		`INSERT INTO iosdist_install_tokens (token, version_id, created_by, expires_at, created_at)
		 VALUES ($1, $2, $3, $4, $5)`,
		t.Token, t.VersionID, t.CreatedBy, t.ExpiresAt, t.CreatedAt,
	)
	return err
}

func (s *Server) getIOSInstallToken(token string) (*IOSInstallToken, error) {
	var t IOSInstallToken
	err := s.db.QueryRow(
		`SELECT token, version_id, created_by, expires_at, created_at, last_accessed_at, access_count
		 FROM iosdist_install_tokens WHERE token = $1`,
		token,
	).Scan(&t.Token, &t.VersionID, &t.CreatedBy, &t.ExpiresAt, &t.CreatedAt, &t.LastAccessedAt, &t.AccessCount)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (s *Server) bumpIOSInstallTokenAccess(token string) error {
	now := time.Now()
	_, err := s.db.Exec(
		`UPDATE iosdist_install_tokens
		 SET last_accessed_at = $1, access_count = access_count + 1
		 WHERE token = $2`,
		now, token,
	)
	return err
}

// ---- Certificates ---------------------------------------------------------

func (s *Server) createIOSCertificate(c *IOSCertificate) error {
	if c == nil {
		return errors.New("ios certificate is nil")
	}
	now := time.Now()
	c.CreatedAt = now
	c.UpdatedAt = now
	return s.db.QueryRow(
		`INSERT INTO iosdist_certificates
			(owner_user_id, name, kind, file_url, file_filename, file_size, password_cipher, password_encrypted, team_id, common_name, notes, expires_at, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
		 RETURNING id`,
		c.OwnerUserID, c.Name, c.Kind, c.FileURL, c.FileFilename, c.FileSize,
		c.passwordCipher, c.PasswordEncrypted,
		c.TeamID, c.CommonName, c.Notes, c.ExpiresAt, now,
	).Scan(&c.ID)
}

func (s *Server) listIOSCertificates(ownerUserID string) ([]IOSCertificate, error) {
	rows, err := s.db.Query(
		`SELECT id, owner_user_id, name, kind, file_url, file_filename, file_size,
			password_cipher, password_encrypted, team_id, common_name, notes, expires_at, created_at, updated_at
		 FROM iosdist_certificates WHERE owner_user_id = $1 ORDER BY updated_at DESC`,
		ownerUserID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IOSCertificate
	for rows.Next() {
		var c IOSCertificate
		if err := rows.Scan(
			&c.ID, &c.OwnerUserID, &c.Name, &c.Kind, &c.FileURL, &c.FileFilename, &c.FileSize,
			&c.passwordCipher, &c.PasswordEncrypted, &c.TeamID, &c.CommonName, &c.Notes, &c.ExpiresAt, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		c.HasPassword = c.passwordCipher != ""
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Server) getIOSCertificate(id int64, ownerUserID string) (*IOSCertificate, error) {
	var c IOSCertificate
	err := s.db.QueryRow(
		`SELECT id, owner_user_id, name, kind, file_url, file_filename, file_size,
			password_cipher, password_encrypted, team_id, common_name, notes, expires_at, created_at, updated_at
		 FROM iosdist_certificates WHERE id = $1 AND owner_user_id = $2`,
		id, ownerUserID,
	).Scan(
		&c.ID, &c.OwnerUserID, &c.Name, &c.Kind, &c.FileURL, &c.FileFilename, &c.FileSize,
		&c.passwordCipher, &c.PasswordEncrypted, &c.TeamID, &c.CommonName, &c.Notes, &c.ExpiresAt, &c.CreatedAt, &c.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	c.HasPassword = c.passwordCipher != ""
	return &c, nil
}

func (s *Server) deleteIOSCertificate(id int64, ownerUserID string) error {
	_, err := s.db.Exec(`DELETE FROM iosdist_certificates WHERE id = $1 AND owner_user_id = $2`, id, ownerUserID)
	return err
}

// ---- Provisioning profiles -----------------------------------------------

func (s *Server) createIOSProfile(p *IOSProvisioningProfile) error {
	if p == nil {
		return errors.New("ios profile is nil")
	}
	now := time.Now()
	p.CreatedAt = now
	p.UpdatedAt = now
	return s.db.QueryRow(
		`INSERT INTO iosdist_profiles
			(owner_user_id, name, kind, file_url, file_filename, file_size, app_id, team_id, udid_count, notes, expires_at, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
		 RETURNING id`,
		p.OwnerUserID, p.Name, p.Kind, p.FileURL, p.FileFilename, p.FileSize,
		p.AppID, p.TeamID, p.UDIDCount, p.Notes, p.ExpiresAt, now,
	).Scan(&p.ID)
}

func (s *Server) listIOSProfiles(ownerUserID string) ([]IOSProvisioningProfile, error) {
	rows, err := s.db.Query(
		`SELECT id, owner_user_id, name, kind, file_url, file_filename, file_size,
			app_id, team_id, udid_count, notes, expires_at, created_at, updated_at
		 FROM iosdist_profiles WHERE owner_user_id = $1 ORDER BY updated_at DESC`,
		ownerUserID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IOSProvisioningProfile
	for rows.Next() {
		var p IOSProvisioningProfile
		if err := rows.Scan(
			&p.ID, &p.OwnerUserID, &p.Name, &p.Kind, &p.FileURL, &p.FileFilename, &p.FileSize,
			&p.AppID, &p.TeamID, &p.UDIDCount, &p.Notes, &p.ExpiresAt, &p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Server) deleteIOSProfile(id int64, ownerUserID string) error {
	_, err := s.db.Exec(`DELETE FROM iosdist_profiles WHERE id = $1 AND owner_user_id = $2`, id, ownerUserID)
	return err
}
