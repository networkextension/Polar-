package dock

import (
	"log"
	"net/netip"
	"time"

	"github.com/gin-gonic/gin"
	geoip2 "github.com/oschwald/geoip2-golang/v2"
)

type loginLocation struct {
	Country string
	Region  string
	City    string
}

func (s *Server) clientIPAddress(c *gin.Context) string {
	if c == nil {
		return ""
	}
	return c.ClientIP()
}

func (s *Server) lookupLoginLocation(ipAddress string) loginLocation {
	if ipAddress == "" {
		return loginLocation{}
	}

	addr, err := netip.ParseAddr(ipAddress)
	if err != nil {
		return loginLocation{}
	}

	if addr.IsLoopback() || addr.IsPrivate() {
		return loginLocation{Country: "Local Network"}
	}

	if s.geoIPReader == nil {
		return loginLocation{}
	}

	city, err := s.geoIPReader.City(addr)
	if err != nil {
		log.Printf("geolite lookup failed for %s: %v", ipAddress, err)
		return loginLocation{}
	}

	location := loginLocation{
		Country: preferredGeoName(city.Country.Names),
		City:    preferredGeoName(city.City.Names),
	}
	if len(city.Subdivisions) > 0 {
		location.Region = preferredGeoName(city.Subdivisions[0].Names)
	}
	return location
}

func preferredGeoName(names geoip2.Names) string {
	switch {
	case names.SimplifiedChinese != "":
		return names.SimplifiedChinese
	case names.English != "":
		return names.English
	case names.Japanese != "":
		return names.Japanese
	default:
		return ""
	}
}

func (s *Server) recordLoginEvent(c *gin.Context, userID, method string) {
	if userID == "" {
		return
	}

	ipAddress := s.clientIPAddress(c)
	location := s.lookupLoginLocation(ipAddress)
	if err := s.createLoginRecord(&LoginRecord{
		UserID:      userID,
		IPAddress:   ipAddress,
		Country:     location.Country,
		Region:      location.Region,
		City:        location.City,
		LoginMethod: method,
		LoggedInAt:  time.Now(),
	}); err != nil {
		log.Printf("create login record failed: %v", err)
	}
}
