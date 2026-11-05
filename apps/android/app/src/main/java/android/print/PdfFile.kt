package android.print

import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import java.io.File

/**
 * Writes what the web page would print straight into a PDF file, so it can go to WhatsApp or email
 * without the print screen. Android only lets code in this package build the two callbacks, which is
 * why this file sits in android.print. If a phone refuses, MainActivity opens the print screen
 * instead (where "Save as PDF" does the same job).
 */
object PdfFile {
    fun write(adapter: PrintDocumentAdapter, attributes: PrintAttributes, file: File, done: (Boolean) -> Unit) {
        adapter.onStart()
        adapter.onLayout(null, attributes, CancellationSignal(), object : PrintDocumentAdapter.LayoutResultCallback() {
            override fun onLayoutFinished(info: PrintDocumentInfo, changed: Boolean) {
                val out = ParcelFileDescriptor.open(
                    file,
                    ParcelFileDescriptor.MODE_CREATE or ParcelFileDescriptor.MODE_TRUNCATE or ParcelFileDescriptor.MODE_READ_WRITE,
                )
                adapter.onWrite(arrayOf(PageRange.ALL_PAGES), out, CancellationSignal(), object : PrintDocumentAdapter.WriteResultCallback() {
                    override fun onWriteFinished(pages: Array<PageRange>) {
                        out.close()
                        adapter.onFinish()
                        done(file.length() > 0)
                    }

                    override fun onWriteFailed(error: CharSequence?) {
                        out.close()
                        adapter.onFinish()
                        done(false)
                    }

                    override fun onWriteCancelled() {
                        out.close()
                        adapter.onFinish()
                        done(false)
                    }
                })
            }

            override fun onLayoutFailed(error: CharSequence?) {
                adapter.onFinish()
                done(false)
            }

            override fun onLayoutCancelled() {
                adapter.onFinish()
                done(false)
            }
        }, null)
    }
}
