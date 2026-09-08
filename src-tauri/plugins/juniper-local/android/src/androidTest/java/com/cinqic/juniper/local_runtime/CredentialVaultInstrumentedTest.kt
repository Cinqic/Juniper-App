package com.cinqic.juniper.local_runtime

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CredentialVaultInstrumentedTest {
    @Test
    fun credentialRoundTripUsesAndroidKeystoreAndDeletionIsEffective() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val reference = "instrumented-${UUID.randomUUID()}"
        val otherReference = "instrumented-other-${UUID.randomUUID()}"
        val secret = "test-secret-not-written-in-plaintext"
        val otherSecret = "different-test-secret"
        val digest = sha256(reference)
        val otherDigest = sha256(otherReference)
        val alias = "juniper.credential.$digest"

        CredentialVault.set(context, reference, secret)
        CredentialVault.set(context, otherReference, otherSecret)
        assertEquals(secret, CredentialVault.get(context, reference))
        val preferences = context.getSharedPreferences("juniper-secure-credentials", 0)
        val stored = preferences.all
        assertTrue(stored.keys.containsAll(setOf("$digest.version", "$digest.ciphertext", "$digest.iv")))
        assertFalse(stored.keys.any { it.contains(secret) })
        assertFalse(stored.values.any { it.toString().contains(secret) })
        val ciphertext = preferences.getString("$digest.ciphertext", null)!!
        val iv = preferences.getString("$digest.iv", null)!!
        assertNotEquals(secret, ciphertext)
        assertNotEquals(secret, String(Base64.decode(ciphertext, Base64.NO_WRAP), StandardCharsets.UTF_8))
        assertEquals(12, Base64.decode(iv, Base64.NO_WRAP).size)

        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        assertTrue(store.containsAlias(alias))
        assertEquals(KeyProperties.KEY_ALGORITHM_AES, store.getKey(alias, null).algorithm)

        val otherCiphertext = preferences.getString("$otherDigest.ciphertext", null)!!
        val otherIv = preferences.getString("$otherDigest.iv", null)!!
        assertTrue(
            preferences.edit()
                .putString("$digest.ciphertext", otherCiphertext)
                .putString("$digest.iv", otherIv)
                .commit(),
        )
        assertTrue("Credential records must be bound to their reference.", runCatching {
            CredentialVault.get(context, reference)
        }.isFailure)

        CredentialVault.delete(context, reference)
        CredentialVault.delete(context, otherReference)
        assertNull(preferences.getString("$digest.ciphertext", null))
        assertNull(preferences.getString("$digest.iv", null))
        assertEquals(0, preferences.getInt("$digest.version", 0))
        store.load(null)
        assertFalse(store.containsAlias(alias))
        assertTrue(runCatching { CredentialVault.get(context, reference) }.isFailure)
    }

    private fun sha256(value: String): String = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(StandardCharsets.UTF_8))
        .joinToString("") { byte -> "%02x".format(byte) }
}
