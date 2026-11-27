// Admit only the scheduler's public, unauthenticated metadata read. The caller continues
// to reject every other external request. The dedicated sync suite exercises failures.
export function sourceHistoryFixtureResponse(request) {
  if (request.method !== 'GET' || request.headers.has('authorization') || request.url !== 'https://api.github.com/repos/thetaxfirm/biomodpeptides/commits?sha=main&per_page=100') return null;
  return Response.json([{ sha: 'f'.repeat(40), commit: { committer: { date: '2026-11-01T00:00:00Z' } } }]);
}
