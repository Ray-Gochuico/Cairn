import { useState, type ReactNode } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDownIcon, ChevronUpIcon, SettingsIcon } from 'lucide-react';

interface CalculatorCardProps {
  title: string;
  headline: string | ReactNode;
  defaultExpanded?: boolean;
  overridePanel?: ReactNode;
  children: ReactNode;
}

export function CalculatorCard({ title, headline, defaultExpanded = true, overridePanel, children }: CalculatorCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showOverride, setShowOverride] = useState(false);

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">{title}</div>
          <div className="text-xl sm:text-2xl font-semibold tabular-nums break-words min-w-0">{headline}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {overridePanel && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowOverride((v) => !v)}
              aria-label={showOverride ? 'Hide override panel' : 'Override inputs'}
            >
              <SettingsIcon className="h-4 w-4 mr-1" /> Override
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronUpIcon className="h-4 w-4" /> : <ChevronDownIcon className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="space-y-4 min-w-0">
          {showOverride && overridePanel && (
            <div className="rounded-md border bg-muted/40 p-3 space-y-2">
              <div className="text-sm font-medium">Override inputs</div>
              {overridePanel}
              <div className="text-xs text-muted-foreground">Changes are temporary. Save-as-What-If is coming in Phase 5.</div>
            </div>
          )}
          {children}
        </CardContent>
      )}
    </Card>
  );
}
