# External Windows SDK

This source release does not include a libmpv DLL or import library. The
previous binary files were omitted from the public snapshot.

Windows rendering is not implemented in this plugin and Windows builds are
not a supported release target. For experimental cross-platform work, supply
your own compatible libmpv SDK and set `MPV_LIB_DIR` to the directory containing
its import library. Review the provenance and licenses of the exact SDK before
redistributing any binary. The environment variable configures linking only;
it does not implement rendering or package the runtime DLL.
