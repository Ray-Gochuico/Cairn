import { useNavigate, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTourStore } from '@/stores/tour-store';

/**
 * Settings → "Getting started". The re-entry surface for the one-time
 * onboarding tour (the wizard's finish flow runs the tour first-run only;
 * this lets a user replay it any time) plus inline pointers to the two
 * visibility editors. Deliberately NO "Re-run tailoring" — tailoring is
 * first-run only by design (spec §E / resolved decision #1); later changes
 * happen here via Settings → Sidebar and the Calculators page.
 *
 * Standard section frame, matched to RefreshSection (Card > CardHeader/
 * CardTitle + a muted helper line + a `variant="outline"` action) so it
 * reads as the same family. Inline links use the app's dominant
 * `text-primary hover:underline` idiom.
 */
export function GettingStartedSection() {
  const navigate = useNavigate();

  const handleReplayTour = () => {
    // start() is idempotent (StrictMode-safe); navigate to the Dashboard,
    // where TourOverlay (mounted in PageShell) renders while active.
    useTourStore.getState().start();
    navigate('/');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="font-semibold leading-none tracking-tight">Getting started</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground mb-3">
          Replay the guided tour, or jump to where you manage which tabs and
          calculators are shown.
        </p>
        <div className="space-y-3">
          <Button type="button" variant="outline" onClick={handleReplayTour}>
            Replay tour
          </Button>
          <p className="text-sm text-muted-foreground">
            Show or hide tabs in the{' '}
            <a href="#sidebar-settings" className="text-primary hover:underline">
              Sidebar settings
            </a>
            {' '}section, or manage calculator cards on the{' '}
            <Link to="/calculators" className="text-primary hover:underline">
              Calculators
            </Link>{' '}
            page.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
