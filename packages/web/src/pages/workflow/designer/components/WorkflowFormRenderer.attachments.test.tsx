import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fileContract } from '@zenith/shared/platform';
import { workflowAttachmentContract, type WorkflowFormField } from '@zenith/shared/workflow';
import WorkflowFormRenderer from './WorkflowFormRenderer';

vi.mock('@/components/FileAttachment', () => ({
  default: ({ uploadPath, uploadData }: { uploadPath?: string; uploadData?: Record<string, unknown> }) => (
    <output data-testid="attachment-upload">{JSON.stringify({ uploadPath, uploadData })}</output>
  ),
}));
const fields: WorkflowFormField[] = [{ key: 'proof', type: 'attachment', label: '证明材料' }];

describe('attachment ownership in the shared form renderer', () => {
  it('sends the concrete workflow instance context regardless of signature mode', () => {
    render(<WorkflowFormRenderer fields={fields} attachmentInstanceId={42} signatureMode="image" />);
    expect(JSON.parse(screen.getByTestId('attachment-upload').textContent!)).toEqual({
      uploadPath: workflowAttachmentContract.upload.fullPath, uploadData: { instanceId: 42 },
    });
  });
  it('keeps report attachments on their explicit public protocol', () => {
    render(<WorkflowFormRenderer fields={fields} attachmentMode="public" attachmentInstanceId={42} />);
    expect(JSON.parse(screen.getByTestId('attachment-upload').textContent!)).toEqual({ uploadPath: fileContract.uploadOne.fullPath });
  });
});
