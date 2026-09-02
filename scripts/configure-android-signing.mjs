/* global URL, console, process */

import { readFile, writeFile } from 'node:fs/promises'

const buildFile = new URL('../src-tauri/gen/android/app/build.gradle.kts', import.meta.url)
let source = await readFile(buildFile, 'utf8')

// Guard each import separately. The generated Gradle script may already
// import one of them, and a duplicate import is a Kotlin compile error
// ("Conflicting import, imported name 'Properties' is ambiguous").
for (const statement of ['import java.util.Properties', 'import java.io.FileInputStream']) {
  if (!source.includes(statement)) source = `${statement}\n${source}`
}

const signingBlock = `    signingConfigs {
        create("release") {
            val keystorePropertiesFile = rootProject.file("keystore.properties")
            val keystoreProperties = Properties()
            require(keystorePropertiesFile.exists()) { "Release keystore.properties is required" }
            keystoreProperties.load(FileInputStream(keystorePropertiesFile))
            keyAlias = keystoreProperties.getProperty("keyAlias")
            keyPassword = keystoreProperties.getProperty("keyPassword")
            storeFile = file(keystoreProperties.getProperty("storeFile"))
            storePassword = keystoreProperties.getProperty("storePassword")
        }
    }

`

if (!source.includes('create("release")')) {
  const marker = '    buildTypes {'
  if (!source.includes(marker)) throw new Error('Android app Gradle file has no buildTypes block.')
  source = source.replace(marker, `${signingBlock}${marker}`)
}

const releaseMarker = '        getByName("release") {'
if (!source.includes(releaseMarker)) {
  throw new Error('Android app Gradle file has no release build type.')
}
if (!source.includes('signingConfig = signingConfigs.getByName("release")')) {
  source = source.replace(
    releaseMarker,
    `${releaseMarker}\n            signingConfig = signingConfigs.getByName("release")`,
  )
}

await writeFile(buildFile, source)
console.log(`Configured Android release signing for ${process.env.RELEASE_TAG ?? 'local build'}.`)
