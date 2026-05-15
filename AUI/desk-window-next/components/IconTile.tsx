import Image from "next/image";

export type IconTileProps = {
  src: string;
  alt: string;
  size: number;
  className?: string;
};

export function IconTile({ src, alt, size, className }: IconTileProps) {
  return (
    <div
      className={["relative shrink-0", className].filter(Boolean).join(" ")}
      style={{ width: size, height: size }}
    >
      <Image src={src} alt={alt} fill sizes={`${size}px`} className="object-contain" />
    </div>
  );
}
