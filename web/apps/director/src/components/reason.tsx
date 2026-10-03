import { IdToken } from '@betsee/ui';
import { Fragment } from 'react';
import { ECOSYSTEM_URL } from './shell.tsx';

const CONTROL_ID = /(CTL-[A-Z]+-\d+)/g;

/**
 * Gateway text shown exactly as sent, with every control id rendered as an IdToken. Inside an
 * element that is already a link (an agent tile), pass linked={false} to avoid nesting anchors.
 */
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
            className="mx-0.5 align-baseline"
          />
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
