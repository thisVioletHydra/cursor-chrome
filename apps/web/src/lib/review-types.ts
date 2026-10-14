import type { DraftRow, FormQuestion, VacancyInfo } from '@cursor-chrome/hh';

export type ReviewCard = {
  id: string;
  title: string;
  company: string;
  url: string;
  place: string;
  at: number;
  partial: boolean;
  questions: FormQuestion[];
  info: VacancyInfo | null;
  infoKnown: boolean;
  drafts: DraftRow[];
};

export type ReviewCounts = { left: number; sent: number; rejected: number; later: number };

export type DraftReply = { info: VacancyInfo | null; drafts: DraftRow[]; error: string };
