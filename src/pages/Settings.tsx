import { AppearanceSection } from '@/components/settings/AppearanceSection';
import { PrivacySection } from '@/components/settings/PrivacySection';
import { SidebarSection } from '@/components/settings/SidebarSection';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { RefreshSection } from '@/components/settings/RefreshSection';
import { LearningSection } from '@/components/settings/LearningSection';
import { DataSection } from '@/components/settings/DataSection';
import { ChartColorsSection } from '@/components/settings/ChartColorsSection';
import { StatementsSection } from '@/components/settings/StatementsSection';
import { UpdaterSection } from '@/components/settings/UpdaterSection';
import { AdvancedSection } from '@/components/settings/AdvancedSection';

export default function Settings() {
  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="mt-1 text-muted-foreground">Manage your app preferences.</p>
      </div>
      <AppearanceSection />
      <PrivacySection />
      <SidebarSection />
      <NotificationsSection />
      <RefreshSection />
      <LearningSection />
      <DataSection />
      <ChartColorsSection />
      <StatementsSection />
      <UpdaterSection />
      <AdvancedSection />
    </div>
  );
}
