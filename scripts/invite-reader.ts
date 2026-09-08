// D44 admission requires a reserved invitation and explicit recipient acceptance.
// The historical Auth-only operator cannot establish either. Fail before loading
// credentials or contacting Auth instead of sending an unusable membership email.
throw new Error("Direct Auth invitations are retired. Use Account → Invite friends in Edison so the invitation has an accountable member slot and acceptance record.");

export {};
