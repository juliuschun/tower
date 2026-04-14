/* ── Current User Badge (JWT에서 username 추출) ── */
export function CurrentUser() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (!payload?.username) return null;
    return (
      <span className="text-[10px] text-surface-600 ml-0.5">
        ({payload.username})
      </span>
    );
  } catch {
    return null;
  }
}
