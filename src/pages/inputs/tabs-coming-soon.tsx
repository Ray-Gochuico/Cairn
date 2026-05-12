interface ComingSoonTabProps {
  name: string;
  phase: number;
}

export default function ComingSoonTab({ name, phase }: ComingSoonTabProps) {
  return (
    <div className="p-6">
      <h2 className="text-xl font-semibold">{name}</h2>
      <p className="mt-2 text-muted-foreground">Coming in Phase {phase}.</p>
    </div>
  );
}
