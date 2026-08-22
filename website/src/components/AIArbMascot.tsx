/**
 * AIArb mascot (same as logo symbol). Used in Hero and Nav.
 */
import { CatPawIcon } from "./CatPawIcon";

interface AIArbMascotProps {
  size?: number;
  className?: string;
}

export function AIArbMascot({
  size = 80,
  className = "",
}: AIArbMascotProps) {
  return <CatPawIcon size={size} className={className} />;
}
