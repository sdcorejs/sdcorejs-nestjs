// UserSnapshot is the canonical export of @sdcorejs/nestjs/core (via orm).
// It was previously re-exported here to avoid a silent export* hole when audit and orm
// were co-located at the same entry. Now that both live under src/core and are
// barrel-re-exported together, the duplicate re-export would suppress UserSnapshot via
// the TypeScript export* conflict rule. Removed — orm remains the sole export source.
