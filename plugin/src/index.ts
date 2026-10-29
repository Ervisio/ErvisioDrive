/**
 * Entry of the ErvisioDrive plugin (SDK v3). The SDK and React are stored first: every component reads them through
 * getSdk() and the `react` shim.
 */
import { setReact } from '@ervisio/plugin-sdk/react';
import { setSdk, type PluginSDK } from './sdk';
import { strings } from './strings';
import { injectStyles } from './styles';
import { DrivePage } from './views/DrivePage';
import { UsageWidget } from './views/UsageWidget';

export default function activate(sdk: PluginSDK): void {
  setSdk(sdk);
  setReact(sdk.react);
  sdk.registerStrings(strings);
  injectStyles();
  sdk.registerPage('drive', DrivePage);
  sdk.registerWidget({ id: 'usage', render: UsageWidget });
}
