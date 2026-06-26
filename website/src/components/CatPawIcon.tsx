interface CatPawIconProps {
  size: number;
  className?: string;
}

const LOGO_SRC = "/qwenpaw-symbol.svg";

export function CatPawIcon({ size, className = "" }: CatPawIconProps) {
  return (
    <img
      src={LOGO_SRC}
      alt="AI Arb"
      width={size}
      height={size}
      className={className}
      style={{
        display: "block",
        margin: "0 auto",
        objectFit: "contain",
      }}
    />
  );
}
