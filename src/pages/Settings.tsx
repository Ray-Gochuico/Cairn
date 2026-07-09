import { GettingStartedSection } from '@/components/settings/GettingStartedSection';
import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { PrivacySection } from '@/components/settings/PrivacySection';
import { SidebarSection } from '@/components/settings/SidebarSection';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { RefreshSection } from '@/components/settings/RefreshSection';
import { DataSection } from '@/components/settings/DataSection';
import { ChartColorsSection } from '@/components/settings/ChartColorsSection';
import { StatementsSection } from '@/components/settings/StatementsSection';
import { UpdaterSection } from '@/components/settings/UpdaterSection';
import { AdvancedSection } from '@/components/settings/AdvancedSection';
import { DisclosuresSection } from '@/components/settings/DisclosuresSection';
import { PageContainer } from '@/components/layout/PageContainer';

// Anchor manifest for the sticky mini-TOC. Labels match the REAL section
// titles (the h2 rendered in each card); ids are the scroll targets on the
// wrapping <section> elements below. Keep this list in the same order as the
// sections render so the rail reads top-to-bottom.
const SECTIONS = [
  { id: 'getting-started', label: 'Getting started', Component: GettingStartedSection },
  { id: 'appearance', label: 'Appearance', Component: AppearanceSection },
  { id: 'privacy', label: 'Privacy & data', Component: PrivacySection },
  { id: 'sidebar', label: 'Sidebar', Component: SidebarSection },
  { id: 'notifications', label: 'Notifications', Component: NotificationsSection },
  { id: 'market-data', label: 'Market data', Component: RefreshSection },
  { id: 'data', label: 'Data', Component: DataSection },
  { id: 'chart-colors', label: 'Chart colors', Component: ChartColorsSection },
  { id: 'statements', label: 'Statements', Component: StatementsSection },
  { id: 'updates', label: 'Updates', Component: UpdaterSection },
  { id: 'advanced', label: 'Advanced', Component: AdvancedSection },
  { id: 'disclosures', label: 'Disclosures', Component: DisclosuresSection },
] as const;

export default function Settings() {
  return (
    <PageContainer width="prose" className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-muted-foreground">Manage your app preferences.</p>
      </div>
      <div className="lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8">
        <nav
          aria-label="Settings sections"
          className="hidden lg:block sticky top-6 self-start text-sm"
        >
          {SECTIONS.map(({ id, label }) => (
            <a
              key={id}
              href={`#${id}`}
              className="block rounded px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="space-y-6">
          {SECTIONS.map(({ id, Component }) => (
            <section key={id} id={id} className="scroll-mt-6">
              <Component />
            </section>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
