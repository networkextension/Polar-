package dock

import (
	"time"

	"github.com/gorilla/websocket"
)

const (
	wsWriteWait  = 10 * time.Second
	wsPongWait   = 60 * time.Second
	wsPingPeriod = (wsPongWait * 9) / 10
	wsMaxMessage = 1024
)

type wsHub struct {
	clients    map[string]map[*wsClient]bool
	register   chan *wsClient
	unregister chan *wsClient
	broadcast  chan wsBroadcast
}

type wsBroadcast struct {
	userIDs []string
	payload []byte
}

type wsClient struct {
	hub    *wsHub
	conn   *websocket.Conn
	send   chan []byte
	userID string
}

func newWSHub() *wsHub {
	return &wsHub{
		clients:    make(map[string]map[*wsClient]bool),
		register:   make(chan *wsClient),
		unregister: make(chan *wsClient),
		broadcast:  make(chan wsBroadcast, 32),
	}
}

func (h *wsHub) run() {
	for {
		select {
		case client := <-h.register:
			group := h.clients[client.userID]
			if group == nil {
				group = make(map[*wsClient]bool)
				h.clients[client.userID] = group
			}
			group[client] = true
		case client := <-h.unregister:
			group := h.clients[client.userID]
			if group != nil {
				if _, ok := group[client]; ok {
					delete(group, client)
					close(client.send)
				}
				if len(group) == 0 {
					delete(h.clients, client.userID)
				}
			}
		case msg := <-h.broadcast:
			for _, userID := range msg.userIDs {
				group := h.clients[userID]
				for client := range group {
					select {
					case client.send <- msg.payload:
					default:
						close(client.send)
						delete(group, client)
					}
				}
			}
		}
	}
}

func (h *wsHub) sendToUsers(userIDs []string, payload []byte) {
	if len(userIDs) == 0 {
		return
	}
	h.broadcast <- wsBroadcast{userIDs: userIDs, payload: payload}
}

func (c *wsClient) readPump() {
	defer func() {
		c.hub.unregister <- c
		_ = c.conn.Close()
	}()
	c.conn.SetReadLimit(wsMaxMessage)
	_ = c.conn.SetReadDeadline(time.Now().Add(wsPongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(wsPongWait))
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			break
		}
	}
}

func (c *wsClient) writePump() {
	ticker := time.NewTicker(wsPingPeriod)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(wsWriteWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
