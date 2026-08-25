# Companion source files

Every block from the SCL Field Manual as importable external sources.

**To import into TIA Portal (V17+):**

1. In the project tree, open *External source files* → *Add new external file* and select the `.scl` / `.udt` files (import the `UDT_*` files first — the FBs reference them).
2. Right-click the imported file → *Generate blocks from source*.
3. The blocks appear under *Program blocks* / *PLC data types*, ready to call.

`solutions/` holds reference implementations for the manual's exercises 1, 2 and 4 —
try the exercises yourself before opening these.

All blocks target S7-1200/1500 with optimized block access and follow the naming
conventions of the Siemens Programming Styleguide.
