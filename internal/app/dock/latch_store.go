package dock

import (
	"crypto/sha1"
	"database/sql"
	"database/sql/driver"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

// LatchProxy represents one version of a proxy configuration.
// Multiple rows share the same GroupID; the latest version is the active one.
type LatchProxy struct {
	ID        string          `json:"id"`
	GroupID   string          `json:"group_id"`
	Name      string          `json:"name"`
	Type      string          `json:"type"` // ss | ss3 | kcp_over_http | kcp_over_ss | kcp_over_ss3
	Config    json.RawMessage `json:"config"`
	SHA1      string          `json:"sha1"`
	Version   int             `json:"version"`
	CreatedAt time.Time       `json:"created_at"`
}

// LatchRule represents one version of a rule file (line-based text).
type LatchRule struct {
	ID        string    `json:"id"`
	GroupID   string    `json:"group_id"`
	Name      string    `json:"name"`
	Content   string    `json:"content"`
	SHA1      string    `json:"sha1"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"created_at"`
}

// LatchProfile is a named configuration combining 0-N proxies and 0-1 rules.
type LatchProfile struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	Description   string    `json:"description"`
	ProxyGroupIDs []string  `json:"proxy_group_ids"`
	RuleGroupID   string    `json:"rule_group_id"` // empty = no rule
	Enabled       bool      `json:"enabled"`
	Shareable     bool      `json:"shareable"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// LatchProfileDetail is the user-facing view of a profile with resolved
// proxy and rule objects (latest version of each, with version numbers).
type LatchProfileDetail struct {
	LatchProfile
	Proxies []LatchProxy `json:"proxies"`
	Rule    *LatchRule   `json:"rule,omitempty"`
}

// ---------------------------------------------------------------------------
// SHA1 helpers
// ---------------------------------------------------------------------------

func latchProxySHA1(configJSON []byte) string {
	h := sha1.New()
	h.Write(configJSON)
	return hex.EncodeToString(h.Sum(nil))
}

func latchRuleSHA1(content string) string {
	h := sha1.New()
	h.Write([]byte(content))
	return hex.EncodeToString(h.Sum(nil))
}

// ---------------------------------------------------------------------------
// Proxy store
// ---------------------------------------------------------------------------

const latchProxySelectCols = `id, group_id, name, type, config, sha1, version, created_at`

func scanLatchProxy(scan func(dest ...any) error) (*LatchProxy, error) {
	var (
		p          LatchProxy
		configJSON []byte
	)
	if err := scan(&p.ID, &p.GroupID, &p.Name, &p.Type, &configJSON, &p.SHA1, &p.Version, &p.CreatedAt); err != nil {
		return nil, err
	}
	if len(configJSON) > 0 {
		p.Config = json.RawMessage(configJSON)
	} else {
		p.Config = json.RawMessage(`{}`)
	}
	return &p, nil
}

// listLatchProxies returns the latest version of every logical proxy (distinct group_id).
func (s *Server) listLatchProxies() ([]LatchProxy, error) {
	rows, err := s.db.Query(`
		SELECT ` + latchProxySelectCols + `
		  FROM latch_proxies lp
		 WHERE version = (
		       SELECT MAX(version) FROM latch_proxies WHERE group_id = lp.group_id
		       )
		 ORDER BY created_at DESC, group_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]LatchProxy, 0)
	for rows.Next() {
		p, err := scanLatchProxy(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, *p)
	}
	return items, rows.Err()
}

// getLatchProxy returns the latest version for the given group_id.
func (s *Server) getLatchProxy(groupID string) (*LatchProxy, error) {
	p, err := scanLatchProxy(s.db.QueryRow(`
		SELECT `+latchProxySelectCols+`
		  FROM latch_proxies
		 WHERE group_id = $1
		 ORDER BY version DESC
		 LIMIT 1`, groupID).Scan)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return p, nil
}

// getLatchProxyVersions returns all versions for a group_id, newest first.
func (s *Server) getLatchProxyVersions(groupID string) ([]LatchProxy, error) {
	rows, err := s.db.Query(`
		SELECT `+latchProxySelectCols+`
		  FROM latch_proxies
		 WHERE group_id = $1
		 ORDER BY version DESC`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]LatchProxy, 0)
	for rows.Next() {
		p, err := scanLatchProxy(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, *p)
	}
	return items, rows.Err()
}

// createLatchProxy creates a new logical proxy at version 1.
func (s *Server) createLatchProxy(name, proxyType string, configJSON []byte, now time.Time) (*LatchProxy, error) {
	groupID := generateResourceID()
	id := generateResourceID()
	sha := latchProxySHA1(configJSON)

	p, err := scanLatchProxy(s.db.QueryRow(`
		INSERT INTO latch_proxies (id, group_id, name, type, config, sha1, version, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,1,$7)
		RETURNING `+latchProxySelectCols,
		id, groupID, name, proxyType, string(configJSON), sha, now).Scan)
	if err != nil {
		return nil, err
	}
	return p, nil
}

// updateLatchProxy compares SHA1 of new config with the current latest.
// If different, a new version row is inserted and returned.
// If identical, the current latest is returned unchanged.
func (s *Server) updateLatchProxy(groupID, name, proxyType string, configJSON []byte, now time.Time) (*LatchProxy, error) {
	current, err := s.getLatchProxy(groupID)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, nil
	}

	newSHA := latchProxySHA1(configJSON)

	// If config unchanged, only update name/type in-place on the current row.
	if newSHA == current.SHA1 {
		p, err := scanLatchProxy(s.db.QueryRow(`
			UPDATE latch_proxies SET name=$2, type=$3
			 WHERE id=$1
			RETURNING `+latchProxySelectCols, current.ID, name, proxyType).Scan)
		if err != nil {
			return nil, err
		}
		return p, nil
	}

	// Content changed → new version.
	id := generateResourceID()
	p, err := scanLatchProxy(s.db.QueryRow(`
		INSERT INTO latch_proxies (id, group_id, name, type, config, sha1, version, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING `+latchProxySelectCols,
		id, groupID, name, proxyType, string(configJSON), newSHA, current.Version+1, now).Scan)
	if err != nil {
		return nil, err
	}
	return p, nil
}

// rollbackLatchProxy promotes an old version by creating a new version entry
// using that version's content (only if it differs from the current latest).
func (s *Server) rollbackLatchProxy(groupID string, targetVersion int, now time.Time) (*LatchProxy, error) {
	// Fetch the target version.
	var target LatchProxy
	var configJSON []byte
	err := s.db.QueryRow(`
		SELECT `+latchProxySelectCols+`
		  FROM latch_proxies
		 WHERE group_id=$1 AND version=$2`, groupID, targetVersion).Scan(
		&target.ID, &target.GroupID, &target.Name, &target.Type,
		&configJSON, &target.SHA1, &target.Version, &target.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	target.Config = json.RawMessage(configJSON)

	return s.updateLatchProxy(groupID, target.Name, target.Type, configJSON, now)
}

// deleteLatchProxy removes all version rows for a group_id.
func (s *Server) deleteLatchProxy(groupID string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM latch_proxies WHERE group_id=$1`, groupID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// ---------------------------------------------------------------------------
// Rules store
// ---------------------------------------------------------------------------

const latchRuleSelectCols = `id, group_id, name, content, sha1, version, created_at`

func scanLatchRule(scan func(dest ...any) error) (*LatchRule, error) {
	var r LatchRule
	if err := scan(&r.ID, &r.GroupID, &r.Name, &r.Content, &r.SHA1, &r.Version, &r.CreatedAt); err != nil {
		return nil, err
	}
	return &r, nil
}

func (s *Server) listLatchRules() ([]LatchRule, error) {
	rows, err := s.db.Query(`
		SELECT ` + latchRuleSelectCols + `
		  FROM latch_rules lr
		 WHERE version = (
		       SELECT MAX(version) FROM latch_rules WHERE group_id = lr.group_id
		       )
		 ORDER BY created_at DESC, group_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]LatchRule, 0)
	for rows.Next() {
		r, err := scanLatchRule(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, *r)
	}
	return items, rows.Err()
}

func (s *Server) getLatchRule(groupID string) (*LatchRule, error) {
	r, err := scanLatchRule(s.db.QueryRow(`
		SELECT `+latchRuleSelectCols+`
		  FROM latch_rules
		 WHERE group_id=$1
		 ORDER BY version DESC
		 LIMIT 1`, groupID).Scan)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return r, nil
}

func (s *Server) getLatchRuleVersions(groupID string) ([]LatchRule, error) {
	rows, err := s.db.Query(`
		SELECT `+latchRuleSelectCols+`
		  FROM latch_rules
		 WHERE group_id=$1
		 ORDER BY version DESC`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]LatchRule, 0)
	for rows.Next() {
		r, err := scanLatchRule(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, *r)
	}
	return items, rows.Err()
}

func (s *Server) createLatchRule(name, content string, now time.Time) (*LatchRule, error) {
	groupID := generateResourceID()
	id := generateResourceID()
	sha := latchRuleSHA1(content)

	r, err := scanLatchRule(s.db.QueryRow(`
		INSERT INTO latch_rules (id, group_id, name, content, sha1, version, created_at)
		VALUES ($1,$2,$3,$4,$5,1,$6)
		RETURNING `+latchRuleSelectCols,
		id, groupID, name, content, sha, now).Scan)
	if err != nil {
		return nil, err
	}
	return r, nil
}

func (s *Server) updateLatchRule(groupID, name, content string, now time.Time) (*LatchRule, error) {
	current, err := s.getLatchRule(groupID)
	if err != nil {
		return nil, err
	}
	if current == nil {
		return nil, nil
	}

	newSHA := latchRuleSHA1(content)

	if newSHA == current.SHA1 {
		// Content unchanged, update name only.
		r, err := scanLatchRule(s.db.QueryRow(`
			UPDATE latch_rules SET name=$2
			 WHERE id=$1
			RETURNING `+latchRuleSelectCols, current.ID, name).Scan)
		if err != nil {
			return nil, err
		}
		return r, nil
	}

	id := generateResourceID()
	r, err := scanLatchRule(s.db.QueryRow(`
		INSERT INTO latch_rules (id, group_id, name, content, sha1, version, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING `+latchRuleSelectCols,
		id, groupID, name, content, newSHA, current.Version+1, now).Scan)
	if err != nil {
		return nil, err
	}
	return r, nil
}

func (s *Server) rollbackLatchRule(groupID string, targetVersion int, now time.Time) (*LatchRule, error) {
	var target LatchRule
	err := s.db.QueryRow(`
		SELECT `+latchRuleSelectCols+`
		  FROM latch_rules
		 WHERE group_id=$1 AND version=$2`, groupID, targetVersion).Scan(
		&target.ID, &target.GroupID, &target.Name, &target.Content, &target.SHA1, &target.Version, &target.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return s.updateLatchRule(groupID, target.Name, target.Content, now)
}

func (s *Server) deleteLatchRule(groupID string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM latch_rules WHERE group_id=$1`, groupID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// ---------------------------------------------------------------------------
// Profile store
// ---------------------------------------------------------------------------

const latchProfileSelectCols = `id, name, description, proxy_group_ids, rule_group_id, enabled, shareable, created_at, updated_at`

func scanLatchProfile(scan func(dest ...any) error) (*LatchProfile, error) {
	var p LatchProfile
	var proxyIDs []string
	var ruleGroupID sql.NullString
	if err := scan(
		&p.ID, &p.Name, &p.Description,
		pqArray(&proxyIDs),
		&ruleGroupID,
		&p.Enabled, &p.Shareable,
		&p.CreatedAt, &p.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if proxyIDs == nil {
		proxyIDs = []string{}
	}
	p.ProxyGroupIDs = proxyIDs
	if ruleGroupID.Valid {
		p.RuleGroupID = ruleGroupID.String
	}
	return &p, nil
}

func (s *Server) listLatchProfiles() ([]LatchProfile, error) {
	rows, err := s.db.Query(`
		SELECT ` + latchProfileSelectCols + `
		  FROM latch_profiles
		 ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]LatchProfile, 0)
	for rows.Next() {
		p, err := scanLatchProfile(rows.Scan)
		if err != nil {
			return nil, err
		}
		items = append(items, *p)
	}
	return items, rows.Err()
}

func (s *Server) getLatchProfile(id string) (*LatchProfile, error) {
	p, err := scanLatchProfile(s.db.QueryRow(`
		SELECT `+latchProfileSelectCols+`
		  FROM latch_profiles
		 WHERE id=$1`, id).Scan)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return p, nil
}

func (s *Server) createLatchProfile(p LatchProfile, now time.Time) (*LatchProfile, error) {
	if strings.TrimSpace(p.ID) == "" {
		p.ID = generateResourceID()
	}
	var ruleGroupID any
	if p.RuleGroupID != "" {
		ruleGroupID = p.RuleGroupID
	}
	created, err := scanLatchProfile(s.db.QueryRow(`
		INSERT INTO latch_profiles (id, name, description, proxy_group_ids, rule_group_id, enabled, shareable, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
		RETURNING `+latchProfileSelectCols,
		p.ID, p.Name, p.Description,
		stringArray(p.ProxyGroupIDs),
		ruleGroupID,
		p.Enabled, p.Shareable, now).Scan)
	if err != nil {
		return nil, err
	}
	return created, nil
}

func (s *Server) updateLatchProfile(id string, p LatchProfile, now time.Time) (*LatchProfile, error) {
	var ruleGroupID any
	if p.RuleGroupID != "" {
		ruleGroupID = p.RuleGroupID
	}
	updated, err := scanLatchProfile(s.db.QueryRow(`
		UPDATE latch_profiles
		   SET name=$2, description=$3, proxy_group_ids=$4, rule_group_id=$5,
		       enabled=$6, shareable=$7, updated_at=$8
		 WHERE id=$1
		RETURNING `+latchProfileSelectCols,
		id, p.Name, p.Description,
		stringArray(p.ProxyGroupIDs),
		ruleGroupID,
		p.Enabled, p.Shareable, now).Scan)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return updated, nil
}

func (s *Server) deleteLatchProfile(id string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM latch_profiles WHERE id=$1`, id)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}

// listSharedLatchProfiles returns all enabled+shareable profiles with resolved
// latest-version proxy and rule objects.
func (s *Server) listSharedLatchProfiles() ([]LatchProfileDetail, error) {
	profiles, err := s.db.Query(`
		SELECT ` + latchProfileSelectCols + `
		  FROM latch_profiles
		 WHERE enabled=TRUE AND shareable=TRUE
		 ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer profiles.Close()

	var details []LatchProfileDetail
	for profiles.Next() {
		p, err := scanLatchProfile(profiles.Scan)
		if err != nil {
			return nil, err
		}
		detail := LatchProfileDetail{LatchProfile: *p}

		// Resolve proxies.
		for _, gid := range p.ProxyGroupIDs {
			proxy, err := s.getLatchProxy(gid)
			if err != nil || proxy == nil {
				continue
			}
			detail.Proxies = append(detail.Proxies, *proxy)
		}
		if detail.Proxies == nil {
			detail.Proxies = []LatchProxy{}
		}

		// Resolve rule.
		if p.RuleGroupID != "" {
			rule, err := s.getLatchRule(p.RuleGroupID)
			if err == nil && rule != nil {
				detail.Rule = rule
			}
		}

		details = append(details, detail)
	}
	if err := profiles.Err(); err != nil {
		return nil, err
	}
	if details == nil {
		details = []LatchProfileDetail{}
	}
	return details, nil
}

// ---------------------------------------------------------------------------
// pqArray helper – wraps a []string for PostgreSQL text[] scanning/binding
// without importing lib/pq.
// ---------------------------------------------------------------------------

type stringArray []string

func pqArray(s *[]string) *stringArray {
	a := stringArray(*s)
	return &a
}

// Scan implements sql.Scanner for text[] columns.
func (a *stringArray) Scan(src any) error {
	if src == nil {
		*a = []string{}
		return nil
	}
	var b []byte
	switch v := src.(type) {
	case []byte:
		b = v
	case string:
		b = []byte(v)
	default:
		return errors.New("latch: unsupported array type")
	}
	s := strings.TrimSpace(string(b))
	if s == "{}" || s == "" {
		*a = []string{}
		return nil
	}
	// Strip { }
	s = strings.TrimPrefix(s, "{")
	s = strings.TrimSuffix(s, "}")
	// Split by comma, handle quoted elements.
	parts := splitPGArray(s)
	*a = parts
	return nil
}

// Value implements driver.Valuer for text[] columns.
func (a stringArray) Value() (driver.Value, error) {
	if len(a) == 0 {
		return "{}", nil
	}
	var sb strings.Builder
	sb.WriteByte('{')
	for i, s := range a {
		if i > 0 {
			sb.WriteByte(',')
		}
		// Quote elements that contain commas, braces, or quotes.
		if strings.ContainsAny(s, `{},"\`) {
			sb.WriteByte('"')
			sb.WriteString(strings.ReplaceAll(s, `"`, `\"`))
			sb.WriteByte('"')
		} else {
			sb.WriteString(s)
		}
	}
	sb.WriteByte('}')
	return sb.String(), nil
}

// splitPGArray parses the inner content of a PostgreSQL array literal.
func splitPGArray(s string) []string {
	var result []string
	var cur strings.Builder
	inQuote := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '"' && !inQuote:
			inQuote = true
		case c == '"' && inQuote:
			if i+1 < len(s) && s[i+1] == '"' {
				cur.WriteByte('"')
				i++
			} else {
				inQuote = false
			}
		case c == ',' && !inQuote:
			result = append(result, cur.String())
			cur.Reset()
		case c == '\\' && inQuote && i+1 < len(s):
			i++
			cur.WriteByte(s[i])
		default:
			cur.WriteByte(c)
		}
	}
	if cur.Len() > 0 || len(result) > 0 {
		result = append(result, cur.String())
	}
	return result
}
