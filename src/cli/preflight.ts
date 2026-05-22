export interface PreFlightOptions {
  skip?: boolean;
}

export async function preFlightChecks(_opts: PreFlightOptions): Promise<void> {
  // Codex availability is checked in runStart after configuration is loaded.
}
