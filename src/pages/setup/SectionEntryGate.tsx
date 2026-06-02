import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

interface Props {
  title: string;
  body: string;
  onStart: () => void;
  onSkip: () => void;
  /** When true, shows a "you skipped this section earlier" hint above the buttons. */
  wasSkipped?: boolean;
}

export default function SectionEntryGate({
  title,
  body,
  onStart,
  onSkip,
  wasSkipped,
}: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{body}</p>
        {wasSkipped && (
          <p className="rounded border border-warning/40 bg-warning-soft p-2 text-xs text-warning-foreground">
            You skipped this section earlier — opening it now?
          </p>
        )}
        <div className="flex gap-2">
          <Button type="button" onClick={onStart}>
            Start this section
          </Button>
          <Button type="button" variant="outline" onClick={onSkip}>
            Skip — none of this applies
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
