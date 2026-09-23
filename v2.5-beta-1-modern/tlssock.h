// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
//
// Minimal SChannel stream wrapper for IRC-over-TLS.

#ifndef _TLSSOCK_H_
#define _TLSSOCK_H_

#ifndef SECURITY_WIN32
#define SECURITY_WIN32
#endif
#include <security.h>
#include <schannel.h>

class CTlsClient
{
public:
	CTlsClient();
	~CTlsClient();

	enum Result { TLS_ERROR, TLS_CONTINUE, TLS_DONE };

	BOOL Begin(const char *serverName, CByteArray &outToken);
	Result Continue(const BYTE *in, int inLen, CByteArray &outToken,
		CByteArray &extraCiphertext);
	BOOL Encrypt(const BYTE *plain, int len, CByteArray &cipher);
	BOOL Decrypt(const BYTE *in, int inLen, CByteArray &plainOut,
		BOOL &renegotiate);

private:
	void Cleanup();

	CredHandle m_cred;
	CtxtHandle m_ctx;
	SecPkgContext_StreamSizes m_sizes;
	CByteArray m_recvBuf;
	CString m_serverName;
	BOOL m_haveCred;
	BOOL m_haveCtx;
	BOOL m_haveSizes;
	BOOL m_complete;
	int m_incompleteCredRetries;
};

#endif // _TLSSOCK_H_
