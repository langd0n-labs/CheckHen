/** Trusted identity is primary; the editable displayName is only a nickname. */
export function primaryName(user: { name?: string | null; email: string }) {
  return user.name?.trim() || user.email;
}

export function instructorLabel(user: { name?: string | null; email: string; displayName?: string | null }) {
  const name = primaryName(user);
  return user.displayName ? `${name} (${user.displayName})` : name;
}
