# Temporary agent progress

The conversation stream accepts `progress` events and `snapshot.progress` from agent-pi.
The reducer stores their text by submission ID in ephemeral `progress` state, separately from
transcript lines, streamed answer text, and results. Repeated events replace the same status;
shared wording is rendered once in an accessible status area marked `data-temporary="true"`.
Progress has no transcript entry and is not saved as chat history or offered as a result.

Terminal submissions and finished progress events remove their status. Run completion or an
idle snapshot clears all status; a busy reconnect snapshot restores the server's latest progress.
The existing working indicator remains the fallback for servers that do not emit progress.
Progress is not spoken by the client and is hidden while a spoken reply is on screen.
