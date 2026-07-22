import type { ReactNode } from 'react';
import { HelpHint } from '../../HelpHint';
import { useI18n } from '../../../i18n';

type CollectionShelfLeadProps = {
  title?: string;
  meta?: string;
  className?: string;
  helpText?: string;
  action?: ReactNode;
};

export function CollectionShelfLead({
  title,
  meta,
  className,
  helpText,
  action
}: CollectionShelfLeadProps) {
  const { t } = useI18n();
  const helpLabel = title ?? meta ?? t('collection.nav.info');

  return (
    <div
      className={[
        'collection-shelf-lead',
        action ? 'collection-shelf-lead--with-action' : 'collection-shelf-lead--without-action',
        className
      ].filter(Boolean).join(' ')}
    >
      <div className="collection-shelf-lead-main">
        {title ? (
          <div className="collection-shelf-lead-copy">
            <strong className="collection-shelf-lead-title">
              {title}
              {helpText ? (
                <HelpHint
                  className="help-hint--inline-title"
                  label={helpLabel}
                  text={helpText}
                />
              ) : null}
            </strong>
          </div>
        ) : null}
      </div>
      {meta || action ? (
        <div className="collection-shelf-lead-trailing">
          {meta ? (
            <span className="collection-shelf-lead-meta-cluster">
              <span className="collection-shelf-lead-meta">{meta}</span>
              {!title && helpText ? (
                <HelpHint
                  className="help-hint--shelf-meta"
                  label={helpLabel}
                  text={helpText}
                />
              ) : null}
            </span>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  );
}
