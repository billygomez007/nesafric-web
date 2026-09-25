/**
 * Shared form-control styling. Controls use the semantic 6px control radius (`rounded-control`)
 * rather than a size-named radius (`rounded-xl`), so they stay consistent with buttons no matter
 * how the panel radius scale evolves. Focus uses the same forest outline as the button system.
 */
export const controlClass =
  "h-11 w-full min-w-0 rounded-control border border-hairline bg-white px-3 text-sm text-ink outline-none transition placeholder:text-slate-500 focus:border-forest focus:ring-2 focus:ring-forest/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-strong";

/** Multi-line variant: same edges and focus, natural height. */
export const textareaClass =
  "w-full min-w-0 rounded-control border border-hairline bg-white p-3 text-sm text-ink outline-none transition placeholder:text-slate-500 focus:border-forest focus:ring-2 focus:ring-forest/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-strong";

/** Visible label that sits above a control. */
export const fieldLabelClass = "mb-1.5 block text-xs font-medium text-muted";
