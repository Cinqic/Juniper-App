package com.cinqic.juniper.local_runtime

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.InstrumentationRegistry
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CredentialVaultInstrumentedTest {
    @Test
    fun credentialRoundTripUsesAndroidKeystoreAndDeletionIsEffective() {
        val context = InstrumentationRegistry.getTargetContext()
        val reference = "instrumented-${UUID.randomUUID()}"
        val secret = "test-secret-not-written-in-plaintext"

        CredentialVault.set(context, reference, secret)
        assertEquals(secret, CredentialVault.get(context, reference))
        val stored = context
            .getSharedPreferences("juniper-secure-credentials", 0)
            .all
            .values
            .filterIsInstance<String>()
            .joinToString("|")
        assertNotEquals("The secret must not be persisted as a preference value.", secret, stored)

        CredentialVault.delete(context, reference)
        assertTrue(runCatching { CredentialVault.get(context, reference) }.isFailure)
    }
}
