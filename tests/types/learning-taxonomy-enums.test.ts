import { describe, it, expect } from 'vitest';
import { QuestionFormat, Topic, Subtopic } from '@/types/enums';

describe('learning taxonomy enums', () => {
  it('QuestionFormat has the three lowercase persisted values', () => {
    expect(QuestionFormat.DEFINITION).toBe('definition');
    expect(QuestionFormat.MATH).toBe('math');
    expect(QuestionFormat.ACCOUNTS).toBe('accounts');
    expect(Object.values(QuestionFormat).length).toBe(3);
  });

  it('Topic has exactly the 13 frozen members with display values', () => {
    expect(Topic.FOUNDATIONS).toBe('Foundations');
    expect(Topic.BUDGETING).toBe('Budgeting');
    expect(Topic.SAVINGS).toBe('Savings');
    expect(Topic.SPENDING).toBe('Spending');
    expect(Topic.CREDIT_DEBT).toBe('Credit & Debt');
    expect(Topic.INVESTMENTS).toBe('Investments');
    expect(Topic.RETIREMENT).toBe('Retirement');
    expect(Topic.INSURANCE).toBe('Insurance');
    expect(Topic.TAXES).toBe('Taxes');
    expect(Topic.JOB).toBe('Job');
    expect(Topic.HOME).toBe('Home');
    expect(Topic.LIFE_EVENTS).toBe('Life Events');
    expect(Topic.DEATH).toBe('Death');
    expect(Object.values(Topic).length).toBe(13);
  });

  it('Subtopic has the 7 insurance members', () => {
    expect(Subtopic.HOME).toBe('Home');
    expect(Subtopic.HEALTH).toBe('Health');
    expect(Subtopic.LIFE).toBe('Life');
    expect(Subtopic.AUTO).toBe('Auto');
    expect(Subtopic.UMBRELLA).toBe('Umbrella');
    expect(Subtopic.DISABILITY).toBe('Disability');
    expect(Subtopic.LONG_TERM_CARE).toBe('Long-term care');
    expect(Object.values(Subtopic).length).toBe(7);
  });
});
