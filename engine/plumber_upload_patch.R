# --- begin patch: robust multipart upload ---

#* @post /data/upload
#* @parser multi
#* @param name The dataset name to store in memory
function(req, name = "my_data") {
  # Accepts multipart/form-data; looks in req$files
  if (is.null(req$files) || length(req$files) == 0) {
    stop("No file uploaded (multipart).")
  }

  # Prefer the field named "file", otherwise take the first file part
  filepart <- req$files[["file"]]
  if (is.null(filepart)) filepart <- req$files[[1]]

  if (is.null(filepart$datapath) || !file.exists(filepart$datapath)) {
    stop("Uploaded file part missing datapath.")
  }

  df <- tryCatch(
    utils::read.csv(filepart$datapath, stringsAsFactors = FALSE, check.names = FALSE),
    error = function(e) stop(paste("Failed to read CSV:", e$message))
  )

  assign(name, df, envir = STONEWARE_DATA)
  list(name = name, rows = nrow(df), cols = ncol(df), columns = unname(colnames(df)))
}

# --- end patch ---
