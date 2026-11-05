import type { GraphQLClient } from 'graphql-request';
import type { InstallMarks } from '$lib/app-install-marks';

export async function readAppInstallMarks(_client: Pick<GraphQLClient, 'request'>, _appRef: string): Promise<InstallMarks> {
  return {};
}
