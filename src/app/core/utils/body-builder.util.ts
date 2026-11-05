import { PreparedBody } from '../models';

/**
 * Converts a prepared body into a `fetch`/XHR body. Multipart uses the native
 * `FormData`, so the browser generates the boundary and Content-Type.
 * Field order and repeated names are preserved, and files are appended as-is
 * (no copy into memory).
 */
export function toBodyInit(body: PreparedBody): FormData | Blob | string | undefined {
  switch (body.type) {
    case 'none':
      return undefined;
    case 'text':
      return body.content;
    case 'binary':
      return body.blob;
    case 'multipart': {
      const form = new FormData();
      for (const field of body.fields) {
        if (field.kind === 'file') {
          form.append(field.name, field.blob, field.filename);
        } else {
          form.append(field.name, field.value);
        }
      }
      return form;
    }
  }
}

/** True when the body carries user files, where upload progress is worth reporting. */
export function isUploadBody(body: PreparedBody): boolean {
  return body.type === 'multipart' || body.type === 'binary';
}
