import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { z } from 'zod';
import {
  FieldError,
  FormErrorSummary,
  humanizeFieldName,
  humanizeZodMessage,
  useFormSubmit,
} from '@/components/forms/form-errors';

describe('humanizeZodMessage', () => {
  it('maps the REAL zod-4 required-string message to "Required"', () => {
    const r = z.string().min(1).safeParse('');
    expect(r.success).toBe(false);
    const raw = r.success ? '' : r.error.issues[0].message;
    expect(humanizeZodMessage(raw)).toBe('Required');
  });
  it('maps numeric bounds and type errors', () => {
    const low = z.number().min(0).safeParse(-1);
    const nan = z.number().safeParse('x');
    expect(humanizeZodMessage(low.success ? '' : low.error.issues[0].message)).toBe('Must be at least 0');
    expect(humanizeZodMessage(nan.success ? '' : nan.error.issues[0].message)).toBe('Enter a number');
  });
  it('passes custom schema messages through untouched', () => {
    expect(humanizeZodMessage('Pick a date after the start date')).toBe('Pick a date after the start date');
  });
});

describe('humanizeFieldName', () => {
  it('sentence-cases camelCase keys', () => {
    expect(humanizeFieldName('annualSalaryPretax')).toBe('Annual salary pretax');
    expect(humanizeFieldName('name')).toBe('Name');
  });
});

describe('FieldError', () => {
  it('renders the humanized message with the given id; renders nothing without one', () => {
    const { rerender } = render(<FieldError id="name-error" message="Too small: expected string to have >=1 characters" />);
    expect(document.getElementById('name-error')).toHaveTextContent('Required');
    rerender(<FieldError id="name-error" message={undefined} />);
    expect(document.getElementById('name-error')).toBeNull();
  });
});

describe('FormErrorSummary', () => {
  it('is a role=alert pane naming humanized fields, not font-mono keys', () => {
    render(<FormErrorSummary fieldErrors={{ annualSalaryPretax: { message: 'x' }, name: { message: 'y' } }} submitError={null} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/fix these 2 fields/i);
    expect(alert).toHaveTextContent('Annual salary pretax');
    expect(alert.querySelector('.font-mono')).toBeNull();
  });
  it('prioritizes a submit failure and reassures the form state is kept', () => {
    render(<FormErrorSummary fieldErrors={{}} submitError="DB locked" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t save.*DB locked.*still on this form/i);
  });
  it('renders nothing when clean', () => {
    render(<FormErrorSummary fieldErrors={{}} submitError={null} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('useFormSubmit', () => {
  it('captures a rejection as submitError instead of an unhandled rejection (M44)', async () => {
    const { result } = renderHook(() => useFormSubmit(async () => { throw new Error('DB locked'); }));
    await act(async () => { await result.current.onValid({} as never); });
    expect(result.current.submitError).toBe('DB locked');
    expect(result.current.submitting).toBe(false);
  });
  it('clears the error on the next attempt and resolves clean', async () => {
    let fail = true;
    const { result } = renderHook(() => useFormSubmit(async () => { if (fail) throw new Error('nope'); }));
    await act(async () => { await result.current.onValid({} as never); });
    fail = false;
    await act(async () => { await result.current.onValid({} as never); });
    expect(result.current.submitError).toBeNull();
  });
});
