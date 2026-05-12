import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { DependentSchema, type Dependent } from '@/types/schema';
import { DependentType } from '@/types/enums';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type DependentFormValues = Omit<Dependent, 'id'>;

export const DEFAULT_DEPENDENT: DependentFormValues = {
  householdId: 1,
  name: '',
  dateOfBirth: '',
  type: DependentType.CHILD,
};

export interface DependentFormProps {
  initial: DependentFormValues;
  onSubmit: (values: DependentFormValues) => Promise<void>;
  onCancel?: () => void;
  submitLabel?: string;
}

/**
 * Standalone dependent form. Used by both the DependentsTab and the
 * SetupWizard Step 3 onboarding flow.
 */
export default function DependentForm({
  initial,
  onSubmit,
  onCancel,
  submitLabel = 'Save',
}: DependentFormProps) {
  const form = useForm<DependentFormValues>({
    resolver: zodResolver(DependentSchema.omit({ id: true })),
    defaultValues: initial,
  });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">Dependent details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" {...form.register('name')} />
          </div>
          <div>
            <Label htmlFor="dateOfBirth">Date of birth</Label>
            <Input id="dateOfBirth" type="date" {...form.register('dateOfBirth')} />
          </div>
          <div>
            <Label htmlFor="type">Type</Label>
            <select
              id="type"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...form.register('type')}
            >
              <option value={DependentType.CHILD}>Child</option>
              <option value={DependentType.OTHER}>Other</option>
            </select>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end items-center gap-3">
        <span
          className="text-sm text-muted-foreground transition-opacity duration-200"
          style={{ opacity: form.formState.isSubmitting ? 1 : 0 }}
          aria-live="polite"
        >
          Saving…
        </span>
        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={form.formState.isSubmitting}
          >
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          disabled={form.formState.isSubmitting || !form.formState.isDirty}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
