export function getDefaultAvatarUrl(): string {
  const v = (process.env.DEFAULT_AVATAR_URL || "").trim();
  return v || "https://placehold.co/128x128?text=Avatar";
}
