import { IdToken } from '@betsee/ui';
import { Fragment } from 'react';
import { ECOSYSTEM_URL } from './shell.tsx';

const CONTROL_ID = /(CTL-[A-Z]+-\d+)/g;

/**
 * Gateway text shown exactly as sent, with every control id rendered as an IdToken. Inside an
 * element that is already a link (an agent tile), pass linked={false} to avoid nesting anchors.
 */
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

export function ReasonText({ text, linked = true }: { text: string; linked?: boolean }) {
  return (
    <>
      {text.split(CONTROL_ID).map((part, i) =>
        i % 2 === 1 ? (
          <IdToken
            key={i}
            id={part}
            copy={false}
            href={linked ? `${ECOSYSTEM_URL}/policy-studio/controls/${encodeURIComponent(part)}` : undefined}
            className="align-baseline"
          />
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
