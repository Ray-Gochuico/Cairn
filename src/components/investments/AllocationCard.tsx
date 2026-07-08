import { memo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import DonutChartCard from '@/components/charts/DonutChartCard';
import { DonutEntityPicker, type DonutEntityPickerItem } from '@/components/charts/DonutEntityPicker';
import { formatCurrency } from '@/lib/format';

/**
 * Asset-allocation card body — extracted 1:1 from the Investments page
 * cardRegistry (wave-7 W4). Purely presentational: the page keeps the
 * allocation memos (they share upstream valuations with other cards) and
 * threads them in as identity-stable props, so the registry memo's audited
 * dep array is unchanged. data-testid, copy, and the all-hidden /
 * no-values empty states are byte-identical to the inline body replaced.
 */

/** Shape produced by the page's aggregateByAssetClass. */
export interface AllocationSlice {
  name: string;
  value: number;
  color: string;
}

export interface AllocationCardProps {
  allocation: AllocationSlice[];
  filteredAllocation: AllocationSlice[];
  allocationTotal: number;
  pickerItems: DonutEntityPickerItem[];
}

function AllocationCardImpl({
  allocation,
  filteredAllocation,
  allocationTotal,
  pickerItems,
}: AllocationCardProps) {
  return allocation.length > 0 ? (
    <div data-testid="asset-allocation-card">
      {filteredAllocation.length > 0 ? (
        <DonutChartCard
          title="Asset allocation"
          subtitle="Approximate, using latest snapshot per account"
          data={filteredAllocation}
          shareTotal={allocationTotal}
          valueFormatter={formatCurrency}
          headerRight={
            <DonutEntityPicker
              localStorageKey="donut.assetAllocation.hidden"
              items={pickerItems}
            />
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle>Asset allocation</CardTitle>
                <CardDescription>
                  Approximate, using latest snapshot per account
                </CardDescription>
              </div>
              {/* Picker must stay reachable in the all-hidden state
                  or the user can never re-show a class. */}
              <DonutEntityPicker
                localStorageKey="donut.assetAllocation.hidden"
                items={pickerItems}
              />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground py-8 text-center">
              All entities hidden. Open the picker above to show at least one.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  ) : (
    <Card data-testid="asset-allocation-card">
      <CardHeader>
        <CardTitle>Asset allocation</CardTitle>
        <CardDescription>
          Approximate, using latest snapshot per account
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        No holding values yet — confirm an account snapshot in the monthly window.
      </CardContent>
    </Card>
  );
}

const AllocationCard = memo(AllocationCardImpl);
AllocationCard.displayName = 'AllocationCard';
export default AllocationCard;
