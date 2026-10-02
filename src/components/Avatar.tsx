export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

/** Foto do perfil quando houver; senão, iniciais sobre a cor do perfil. */
export function Avatar({
  name,
  color,
  size = 40,
  src,
  className = "",
}: {
  name: string;
  color: string;
  size?: number;
  src?: string | null;
  className?: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={`rounded-full object-cover flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className={`rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0 ${className}`}
      style={{ backgroundColor: color, width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </div>
  );
}
