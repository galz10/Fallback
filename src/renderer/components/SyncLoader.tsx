import { DotmCircular3 } from "./ui/dotm-circular-3";

export function SyncLoader({
  size = 17,
  dotSize = 2.5,
  speed = 1.6,
  color = "#f4f4f5",
  className,
  label = "Syncing"
}: {
  size?: number;
  dotSize?: number;
  speed?: number;
  color?: string;
  className?: string;
  label?: string;
}) {
  return (
    <DotmCircular3
      size={size}
      dotSize={dotSize}
      speed={speed}
      color={color}
      pattern="full"
      animated
      hoverAnimated={false}
      muted={false}
      bloom={false}
      halo={0}
      opacityBase={0.12}
      opacityMid={0.42}
      opacityPeak={1}
      cellPadding={1.125}
      boxSize={0}
      minSize={0}
      className={className}
      ariaLabel={label}
    />
  );
}
