package uk.careschedule.rota

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.print.PdfFile
import android.print.PrintAttributes
import android.print.PrintManager
import android.util.Base64
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File

/**
 * Shows CareSchedule.html (the same page the desktop app uses) and does what a web page can't on a
 * phone: pop-up messages, opening files, sharing or saving files, making PDFs and printing.
 */
class MainActivity : ComponentActivity() {
    companion object {
        // the page is served from the app's own files at this address – a fixed address, so the copy
        // of the rota kept on the phone (for viewing offline) stays put between launches
        private const val HOST = "appassets.androidplatform.net"
        private const val PAGE = "https://$HOST/assets/CareSchedule.html"
    }

    private lateinit var web: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingSave: Pair<String, ByteArray>? = null

    private val pickFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    private val saveFile = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val target = result.data?.data
        val (_, bytes) = pendingSave ?: return@registerForActivityResult
        pendingSave = null
        if (target == null) return@registerForActivityResult
        try {
            contentResolver.openOutputStream(target)?.use { it.write(bytes) }
            toast("Saved")
        } catch (e: Exception) {
            toast("Could not save the file: ${e.message}")
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge() // the same layout on every Android version; the padding below keeps it clear

        val loader = WebViewAssetLoader.Builder()
            .setDomain(HOST)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true      // the rota keeps its copy and sign-in in the page's storage
            allowFileAccess = false
            allowContentAccess = true
            textZoom = 100
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            // web links open in the browser rather than replacing the rota
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == HOST) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, request.url)) } catch (_: ActivityNotFoundException) { }
                return true
            }
        }

        // a WebChromeClient also turns on alert() and confirm()
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    val types = mimeTypes(params.acceptTypes)
                    if (types.isNotEmpty()) putExtra(Intent.EXTRA_MIME_TYPES, types)
                }
                return try {
                    pickFile.launch(Intent.createChooser(intent, "Choose a file"))
                    true
                } catch (_: ActivityNotFoundException) {
                    fileCallback = null
                    false
                }
            }
        }

        web.addJavascriptInterface(Bridge(), "careNative")

        // keep the page clear of the status bar, the navigation bar and the keyboard
        val frame = FrameLayout(this)
        frame.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        ViewCompat.setOnApplyWindowInsetsListener(frame) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        setContentView(frame)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (web.canGoBack()) web.goBack() else finish()
            }
        })

        if (savedInstanceState != null) web.restoreState(savedInstanceState) else web.loadUrl(PAGE)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
    }

    override fun onPause() {
        web.onPause()
        super.onPause()
    }

    /** What the page can call (see nativeConfig() and nativeApp() in CareSchedule.html). */
    inner class Bridge {
        /** The shared-storage details from apps/config.json, plus this phone's name. */
        @JavascriptInterface
        fun getConfig(): String {
            val cfg = try {
                JSONObject(assets.open("config.json").bufferedReader().use { it.readText() })
            } catch (_: Exception) {
                JSONObject()
            }
            cfg.put("device", Build.MODEL ?: "Android phone")
            return cfg.toString()
        }

        @JavascriptInterface
        fun post(json: String) {
            val msg = try { JSONObject(json) } catch (_: Exception) { return }
            runOnUiThread { handle(msg) }
        }
    }

    private fun handle(msg: JSONObject) {
        val name = safeName(msg.optString("name", "CareSchedule"))
        val landscape = msg.optBoolean("landscape", false)
        when (msg.optString("kind")) {
            "file" -> {
                val bytes = try { Base64.decode(msg.optString("base64"), Base64.DEFAULT) } catch (_: Exception) { return }
                offerFile(name, msg.optString("type", "application/octet-stream"), bytes)
            }
            "pdf" -> makePdf(if (name.endsWith(".pdf")) name else "$name.pdf", landscape)
            "print" -> openPrintScreen(name, landscape)
        }
    }

    private fun safeName(name: String) = name.replace(Regex("[/\\\\:?%*|\"<>]"), "-")

    /** Share (WhatsApp, Gmail, Drive…) or save into the phone's files. */
    private fun offerFile(name: String, type: String, bytes: ByteArray) {
        AlertDialog.Builder(this)
            .setTitle(name)
            .setItems(arrayOf("Share…", "Save to phone…")) { _, which ->
                if (which == 0) share(writeShared(name, bytes), type)
                else {
                    pendingSave = name to bytes
                    saveFile.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        this.type = type
                        putExtra(Intent.EXTRA_TITLE, name)
                    })
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun writeShared(name: String, bytes: ByteArray?): File {
        val dir = File(cacheDir, "shared")
        dir.deleteRecursively()
        dir.mkdirs()
        val file = File(dir, name)
        if (bytes != null) file.writeBytes(bytes)
        return file
    }

    private fun share(file: File, type: String) {
        val uri = FileProvider.getUriForFile(this, "$packageName.files", file)
        val send = Intent(Intent.ACTION_SEND).apply {
            this.type = type
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(send, file.name))
    }

    private fun attributes(landscape: Boolean): PrintAttributes = PrintAttributes.Builder()
        .setMediaSize(if (landscape) PrintAttributes.MediaSize.ISO_A4.asLandscape() else PrintAttributes.MediaSize.ISO_A4.asPortrait())
        .setResolution(PrintAttributes.Resolution("pdf", "pdf", 300, 300))
        .setMinMargins(PrintAttributes.Margins.NO_MARGINS) // the page sets its own 10 mm margins
        .build()

    /** A4 PDF from the page's print layout, ready to send to carers. */
    private fun makePdf(name: String, landscape: Boolean) {
        val file = writeShared(name, null)
        var finished = false
        val fallback = Runnable {
            if (!finished) { finished = true; openPrintScreen(name, landscape) }
        }
        val handler = Handler(Looper.getMainLooper())
        try {
            PdfFile.write(web.createPrintDocumentAdapter(name), attributes(landscape), file) { ok ->
                runOnUiThread {
                    if (finished) return@runOnUiThread
                    finished = true
                    handler.removeCallbacks(fallback)
                    if (ok) share(file, "application/pdf") else openPrintScreen(name, landscape)
                }
            }
            handler.postDelayed(fallback, 20_000)
        } catch (_: Throwable) {
            // this phone doesn't allow writing PDFs directly – use the print screen ("Save as PDF")
            fallback.run()
        }
    }

    private fun openPrintScreen(name: String, landscape: Boolean) {
        val printer = getSystemService(PRINT_SERVICE) as PrintManager
        printer.print(name, web.createPrintDocumentAdapter(name), attributes(landscape))
    }

    private fun mimeTypes(accept: Array<String>?): Array<String> {
        val known = mapOf(
            ".xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ".csv" to "text/csv",
            ".json" to "application/json",
        )
        val out = mutableListOf<String>()
        accept.orEmpty().flatMap { it.split(',') }.map { it.trim().lowercase() }.filter { it.isNotEmpty() }.forEach {
            when {
                it.contains('/') -> out += it
                known.containsKey(it) -> out += known.getValue(it)
            }
        }
        if (out.contains("text/csv")) out += listOf("text/comma-separated-values", "application/csv", "text/plain")
        if (out.contains("application/json")) out += listOf("text/plain", "application/octet-stream")
        return out.distinct().toTypedArray()
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_LONG).show()
}
