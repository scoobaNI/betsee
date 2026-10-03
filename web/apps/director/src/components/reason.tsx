import { Fragment } from 'react';
import { Code, controlHref } from './ui.tsx';

const CONTROL_ID = /(CTL-[A-Z]+-\d+)/g;

/** Lets a long identifier wrap only after '/' or ':' (never mid-word). */
export function Breakable({ text }: { text: string }) {
  return (
    <>
      {text.split(/(?<=[/:])/).map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Gateway text shown exactly as sent, with every control id set apart. Inside an element that is
 * already a link (an agent row), pass linked={false} to avoid nesting anchors.
 */
export function ReasonText({ text, linked = true }: { text: string; linked?: boolean }) {
  return (
    <>
      {text.split(CONTROL_ID).map((part, i) =>
        i % 2 === 1 ? (
          <Code key={i} href={linked ? controlHref(part) : undefined} className="px-1 py-0 align-baseline text-[0.9em] leading-normal">
            {part}
          </Code>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
