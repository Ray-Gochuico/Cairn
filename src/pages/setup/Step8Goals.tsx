import { Button } from '@/components/ui/button';

interface Props {
  onComplete: () => void;
}

/**
 * Setup wizard Step 9 — Goals placeholder. Goals tracking is Phase 3
 * surface, so the final wizard step is just a celebratory "All set!"
 * card with a Finish button that hands control back to SetupWizard.tsx
 * to navigate to the dashboard and kick off snapshot derivation.
 */
export default function Step8Goals({ onComplete }: Props) {
  return (
    <div className="max-w-2xl mx-auto text-center space-y-4">
      <h2 className="text-2xl font-semibold">All set!</h2>
      <p className="text-muted-foreground">
        Goals come in Phase 3 — you can set them up from the Inputs page later.
      </p>
      <p className="text-muted-foreground">
        Click <strong>Finish</strong> to start using the app.
      </p>
      <Button onClick={onComplete} size="lg">
        Finish
      </Button>
    </div>
  );
}
