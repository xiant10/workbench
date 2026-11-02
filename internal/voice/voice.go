// Package voice gets a room token from the auth service. The browser then joins
// LiveKit directly, and the user's own token stays in this service.
package voice

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"t10-workbench/internal/session"
)

// Admission is what the browser needs. Admission's other fields stay here.
type Admission struct {
	RoomToken string `json:"room_token"`
	RoomName  string `json:"room_name"`
	Identity  string `json:"identity"`
	ServerURL string `json:"server_url"`
	ExpiresAt string `json:"expires_at"`
}

// Refused is a refusal from the auth service, to pass on with its status.
type Refused struct {
	Status int
	Code   string
}

func (r Refused) Error() string { return fmt.Sprintf("admission refused: %d %s", r.Status, r.Code) }

// Admit asks for a room in the token's tenant. fixedRoom, when set, wins.
func Admit(ctx context.Context, auth *session.AuthClient, token, room string) (Admission, error) {
	status, body, err := auth.Call(ctx, http.MethodPost, "/v1/rooms/admission", token, map[string]string{"room": room})
	if err != nil {
		return Admission{}, err
	}
	if status != http.StatusOK {
		var refused struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &refused)
		return Admission{}, Refused{Status: status, Code: refused.Error}
	}
	var admission Admission
	if err := json.Unmarshal(body, &admission); err != nil {
		return Admission{}, fmt.Errorf("parse admission: %w", err)
	}
	return admission, nil
}
