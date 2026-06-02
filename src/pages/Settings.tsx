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

export default function Settings() {
  return (
    <PageContainer width="prose" className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-muted-foreground">Manage your app preferences.</p>
      </div>
      <AppearanceSection />
      <PrivacySection />
      <SidebarSection />
      <NotificationsSection />
      <RefreshSection />
      <DataSection />
      <ChartColorsSection />
      <StatementsSection />
      <UpdaterSection />
      <AdvancedSection />
      <DisclosuresSection />
    </PageContainer>
  );
}
