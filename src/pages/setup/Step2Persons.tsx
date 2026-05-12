import { Button } from '@/components/ui/button';

interface Props {
  onComplete: () => void;
}

// Stub — wired in Unit H Task 22.
export default function Step2Persons({ onComplete }: Props) {
  return (
    <div className="border rounded-md p-8 text-center space-y-3">
      <p className="text-muted-foreground">Step 2: Persons (stub)</p>
      <Button type="button" onClick={onComplete}>
        Continue
      </Button>
    </div>
  );
}
