// Connector registration barrel. Importing this module registers every
// built-in connector as a side effect; import it once (the manga page does)
// before calling getConnectorFor(). Re-exports getConnectorFor so callers can
// get both from a single import.

import { registerConnector, getConnectorFor } from "../connector";
import { mangadexConnector } from "./mangadex";
import { comickConnector } from "./comick";
import { suwayomiConnector } from "./suwayomi";
import { extensionConnector } from "./extension";

registerConnector(mangadexConnector);
registerConnector(comickConnector);
registerConnector(suwayomiConnector);
registerConnector(extensionConnector);

export { getConnectorFor };
export {
  mangadexConnector,
  comickConnector,
  suwayomiConnector,
  extensionConnector,
};
