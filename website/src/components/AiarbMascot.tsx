/**
 * AIArb mascot (same as logo symbol). Used in Hero and Nav.
 */
import { CatPawIcon } from "./CatPawIcon";

interface AiarbMascotProps {
  size?: number;
  className?: string;
}

export function AiarbMascot({
  size = 80,
  className = "",
}: AiarbMascotProps) {
  return <CatPawIcon size={size} className={className} />;
}
